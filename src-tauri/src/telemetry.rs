use opentelemetry::logs::AnyValue;
use opentelemetry::KeyValue;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_sdk::error::OTelSdkResult;
use opentelemetry_sdk::logs::{LogBatch, LogExporter, SdkLoggerProvider, SimpleLogProcessor};
use opentelemetry_sdk::Resource;
use serde_json::{json, Map, Value};
use std::io::Write;
use std::mem::ManuallyDrop;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_appender::rolling;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::{EnvFilter, Registry};

pub const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

pub struct TelemetryGuards {
  file_guard: ManuallyDrop<WorkerGuard>,
  provider: ManuallyDrop<SdkLoggerProvider>,
}

impl Drop for TelemetryGuards {
  fn drop(&mut self) {
    // Shut down OTel provider before stopping the non-blocking writer worker.
    unsafe {
      ManuallyDrop::drop(&mut self.provider);
      ManuallyDrop::drop(&mut self.file_guard);
    }
  }
}

/// Installs a panic hook that forwards panic messages into the `tracing` pipeline
/// (so they land in the log file when a subscriber is installed) in addition to
/// running the default hook (which prints to stderr). Panic hooks run even when
/// the release profile uses `panic = "abort"`, unlike `catch_unwind`.
pub fn install_panic_hook() {
  let default_hook = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |panic_info| {
    let location = panic_info
      .location()
      .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
      .unwrap_or_else(|| "unknown location".to_string());
    let message = panic_info
      .payload()
      .downcast_ref::<&str>()
      .map(|s| s.to_string())
      .or_else(|| panic_info.payload().downcast_ref::<String>().cloned())
      .unwrap_or_else(|| "<non-string panic payload>".to_string());
    tracing::error!(target: "panic", "panic at {}: {}", location, message);
    default_hook(panic_info);
  }));
}

pub fn init(log_dir: &Path) -> Result<TelemetryGuards, Box<dyn std::error::Error>> {
  std::fs::create_dir_all(log_dir)?;
  cleanup_old_logs(log_dir, MAX_AGE);

  let appender = rolling::daily(log_dir, "treq");
  let (writer, file_guard) = tracing_appender::non_blocking(appender);

  let exporter = FileLogExporter::new(writer);

  let resource = Resource::builder()
    .with_attributes(vec![
      KeyValue::new("service.name", "treq"),
      KeyValue::new("service.version", env!("CARGO_PKG_VERSION")),
    ])
    .build();

  let provider = SdkLoggerProvider::builder()
    .with_log_processor(SimpleLogProcessor::new(exporter))
    .with_resource(resource)
    .build();

  let otel_layer = OpenTelemetryTracingBridge::new(&provider);

  let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
  let subscriber = Registry::default().with(filter).with(otel_layer);
  tracing::subscriber::set_global_default(subscriber)?;

  Ok(TelemetryGuards {
    file_guard: ManuallyDrop::new(file_guard),
    provider: ManuallyDrop::new(provider),
  })
}

/// Forward a `log` record into tracing so records from `tauri-plugin-log`
/// (Rust `log::*` macros and JS `@tauri-apps/plugin-log`) end up in the OTel pipeline.
pub fn forward_log_record(record: &log::Record<'_>) {
  let source = record.target();
  let msg = record.args();
  match record.level() {
    log::Level::Error => tracing::error!(source = source, "{}", msg),
    log::Level::Warn => tracing::warn!(source = source, "{}", msg),
    log::Level::Info => tracing::info!(source = source, "{}", msg),
    log::Level::Debug => tracing::debug!(source = source, "{}", msg),
    log::Level::Trace => tracing::trace!(source = source, "{}", msg),
  }
}

pub fn cleanup_old_logs(dir: &Path, max_age: Duration) {
  let Some(cutoff) = SystemTime::now().checked_sub(max_age) else {
    return;
  };
  let Ok(entries) = std::fs::read_dir(dir) else {
    return;
  };
  for entry in entries.flatten() {
    let Ok(meta) = entry.metadata() else { continue };
    if !meta.is_file() {
      continue;
    }
    let Ok(modified) = meta.modified() else {
      continue;
    };
    if modified < cutoff {
      let _ = std::fs::remove_file(entry.path());
    }
  }
}

/// Custom OTel log exporter that writes one OTLP-shaped JSON object per line
/// to the provided writer. Used because `opentelemetry-stdout` 0.32 hardcodes
/// output to stdout and provides no writer hook.
#[derive(Debug)]
pub struct FileLogExporter {
  writer: Mutex<NonBlocking>,
  resource_attributes: Mutex<Vec<Value>>,
}

impl FileLogExporter {
  pub fn new(writer: NonBlocking) -> Self {
    Self {
      writer: Mutex::new(writer),
      resource_attributes: Mutex::new(Vec::new()),
    }
  }
}

impl LogExporter for FileLogExporter {
  async fn export(&self, batch: LogBatch<'_>) -> OTelSdkResult {
    let resource_attrs = self
      .resource_attributes
      .lock()
      .ok()
      .map(|r| r.clone())
      .unwrap_or_default();

    // Group log records by instrumentation scope so the OTLP envelope stays correct across scopes.
    let mut scope_groups: Vec<(String, Option<String>, Vec<Value>)> = Vec::new();
    for (record, scope) in batch.iter() {
      let name = scope.name().to_string();
      let version = scope.version().map(|v| v.to_string());
      let record_json = otlp_log_record(record);
      if let Some(group) = scope_groups
        .iter_mut()
        .find(|(n, v, _)| *n == name && *v == version)
      {
        group.2.push(record_json);
      } else {
        scope_groups.push((name, version, vec![record_json]));
      }
    }

    let scope_logs: Vec<Value> = scope_groups
      .into_iter()
      .map(|(name, version, records)| {
        let mut scope_obj = Map::new();
        if !name.is_empty() {
          scope_obj.insert("name".to_string(), Value::String(name));
        }
        if let Some(v) = version {
          scope_obj.insert("version".to_string(), Value::String(v));
        }
        json!({
            "scope": Value::Object(scope_obj),
            "logRecords": records,
        })
      })
      .collect();

    if scope_logs.is_empty() {
      return Ok(());
    }

    let line = json!({
        "resourceLogs": [{
            "resource": { "attributes": resource_attrs },
            "scopeLogs": scope_logs,
        }]
    });

    let out = format!("{}\n", line);
    if let Ok(mut w) = self.writer.lock() {
      let _ = w.write_all(out.as_bytes());
    }
    Ok(())
  }

  fn set_resource(&mut self, resource: &Resource) {
    let mut attrs: Vec<Value> = Vec::new();
    for (k, v) in resource.iter() {
      attrs.push(json!({
          "key": k.as_str(),
          "value": otel_value_to_otlp(v),
      }));
    }
    if let Ok(mut slot) = self.resource_attributes.lock() {
      *slot = attrs;
    }
  }
}

fn otlp_log_record(record: &opentelemetry_sdk::logs::SdkLogRecord) -> Value {
  let time_unix_nano = record
    .timestamp()
    .or_else(|| record.observed_timestamp())
    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
    .map(|d| d.as_nanos().to_string())
    .unwrap_or_default();

  let severity_number = record
    .severity_number()
    .map(|s| s as u8 as i64)
    .unwrap_or(0);
  let severity_text = record.severity_text().unwrap_or("");

  let body = record.body().map(any_value_to_otlp).unwrap_or(Value::Null);

  let mut attributes: Vec<Value> = Vec::new();
  for (k, v) in record.attributes_iter() {
    attributes.push(json!({
        "key": k.as_str(),
        "value": any_value_to_otlp(v),
    }));
  }

  json!({
      "timeUnixNano": time_unix_nano,
      "severityNumber": severity_number,
      "severityText": severity_text,
      "body": body,
      "attributes": attributes,
  })
}

fn any_value_to_otlp(v: &AnyValue) -> Value {
  match v {
    AnyValue::Int(i) => json!({ "intValue": i.to_string() }),
    AnyValue::Double(f) => json!({ "doubleValue": *f }),
    AnyValue::String(s) => json!({ "stringValue": s.as_str() }),
    AnyValue::Boolean(b) => json!({ "boolValue": *b }),
    AnyValue::Bytes(b) => json!({ "bytesValue": b.to_vec() }),
    AnyValue::ListAny(list) => json!({
        "arrayValue": {
            "values": list.iter().map(any_value_to_otlp).collect::<Vec<_>>()
        }
    }),
    AnyValue::Map(map) => {
      let kvlist: Vec<Value> = map
        .iter()
        .map(|(k, v)| json!({ "key": k.as_str(), "value": any_value_to_otlp(v) }))
        .collect();
      json!({ "kvlistValue": { "values": kvlist } })
    }
    _ => Value::Null,
  }
}

fn otel_value_to_otlp(v: &opentelemetry::Value) -> Value {
  use opentelemetry::Value as V;
  match v {
    V::Bool(b) => json!({ "boolValue": *b }),
    V::I64(i) => json!({ "intValue": i.to_string() }),
    V::F64(f) => json!({ "doubleValue": *f }),
    V::String(s) => json!({ "stringValue": s.as_str() }),
    V::Array(_) => json!({ "stringValue": format!("{:?}", v) }),
    _ => Value::Null,
  }
}
