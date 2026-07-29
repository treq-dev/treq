//! Log collection and querying for workflow check runs.
//!
//! Each job in a run streams its step output to a newline-delimited JSON file
//! under `.treq/runs/{run_id}/{job_id}.jsonl`. Records follow the OpenTelemetry
//! log data model, so a run's logs can be read by OTel-aware tooling without
//! translation, and the DuckDB views expose the standard field names.
//!
//! Reads go through DuckDB's `read_json_auto`, which lets the logs browser
//! filter and paginate without loading a whole run into memory.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Describes the entity that generated the log, per OTel resource conventions.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Resource {
    #[serde(rename = "service.name")]
    pub service_name: String,
    #[serde(rename = "service.version")]
    pub service_version: String,
}

impl Default for Resource {
    fn default() -> Self {
        Self {
            service_name: "treq".to_string(),
            service_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

/// The scope that emitted the log.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct InstrumentationScope {
    pub name: String,
    pub version: String,
}

impl Default for InstrumentationScope {
    fn default() -> Self {
        Self {
            name: "treq.checks".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

/// Structured log body. OTel allows any value; a map keeps room to grow
/// without turning `body` into a bare string later.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Body {
    pub message: String,
}

/// Everything specific to treq lives here rather than as top-level fields, so
/// the record stays exactly the OTel log data model.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Attributes {
    pub run_id: i64,
    pub job_id: String,
    pub step_index: i64,
    pub step_name: String,
    /// OTel's convention for which standard stream a line came from.
    #[serde(rename = "log.iostream")]
    pub log_iostream: String,
}

/// One captured output line as an OpenTelemetry LogRecord.
///
/// The field set is exactly the OTel log data model — no treq-specific columns
/// at the top level. `traceId`/`spanId` are derived from the run and job so a
/// run reads as a trace and each job as a span within it.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    /// RFC3339 UTC with nanosecond precision: fixed width, so it sorts
    /// correctly as text and still parses as a DuckDB TIMESTAMP.
    pub timestamp: String,
    pub observed_timestamp: String,
    pub trace_id: String,
    pub span_id: String,
    /// W3C trace flags; bit 0 is "sampled".
    pub trace_flags: u8,
    pub severity_text: String,
    pub severity_number: u8,
    pub body: Body,
    pub resource: Resource,
    pub instrumentation_scope: InstrumentationScope,
    pub attributes: Attributes,
    /// Identifies the class of event these records represent.
    pub event_name: String,
}

/// Every record we emit is a line of step output.
const EVENT_NAME: &str = "check.step.output";

/// Marks records as sampled, the only trace-flag bit that applies here.
const TRACE_FLAGS_SAMPLED: u8 = 1;

// ── Timestamps ───────────────────────────────────────────────────────────────

/// Current time as RFC3339 UTC with nanosecond precision.
pub fn now_timestamp() -> String {
    format_timestamp(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0),
    )
}

/// Render epoch nanoseconds as fixed-width RFC3339, so text ordering matches
/// chronological ordering and DuckDB still infers a TIMESTAMP.
pub fn format_timestamp(unix_nano: u64) -> String {
    let secs = (unix_nano / 1_000_000_000) as i64;
    let nanos = (unix_nano % 1_000_000_000) as u32;
    chrono::DateTime::from_timestamp(secs, nanos)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H:%M:%S%.9fZ")
        .to_string()
}

// ── OTel severity ────────────────────────────────────────────────────────────

/// UI-facing level names mapped to their OTel severity text.
pub fn severity_text_for_level(level: &str) -> &'static str {
    match level {
        "error" => "ERROR",
        "warning" => "WARN",
        _ => "INFO",
    }
}

/// OTel severity numbers: INFO=9, WARN=13, ERROR=17.
pub fn severity_number_for_text(severity_text: &str) -> u8 {
    match severity_text {
        "ERROR" => 17,
        "WARN" => 13,
        _ => 9,
    }
}

/// A run becomes a trace; ids are derived so they are stable and reproducible
/// rather than random, which keeps re-reads of a log file consistent.
pub fn trace_id_for_run(run_id: i64) -> String {
    format!("{:032x}", run_id as u128)
}

/// Each job becomes a span within its run's trace.
pub fn span_id_for_job(run_id: i64, job_id: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in job_id.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    hash ^= run_id as u64;
    format!("{:016x}", hash)
}

/// Build an OTel record for one captured line.
#[allow(clippy::too_many_arguments)]
pub fn make_log_line(
    timestamp: String,
    run_id: i64,
    job_id: &str,
    step_index: i64,
    step_name: &str,
    stream: &str,
    level: &str,
    message: &str,
) -> LogLine {
    let severity_text = severity_text_for_level(level);
    LogLine {
        observed_timestamp: timestamp.clone(),
        timestamp,
        trace_id: trace_id_for_run(run_id),
        span_id: span_id_for_job(run_id, job_id),
        trace_flags: TRACE_FLAGS_SAMPLED,
        severity_text: severity_text.to_string(),
        severity_number: severity_number_for_text(severity_text),
        body: Body {
            message: message.to_string(),
        },
        resource: Resource::default(),
        instrumentation_scope: InstrumentationScope::default(),
        attributes: Attributes {
            run_id,
            job_id: job_id.to_string(),
            step_index,
            step_name: step_name.to_string(),
            log_iostream: stream.to_string(),
        },
        event_name: EVENT_NAME.to_string(),
    }
}

/// Filters accepted by the logs browser.
///
/// `levels` is a set: an empty or absent list means "no level filter", matching
/// the multi-select showing nothing ticked.
#[derive(Debug, Deserialize, Default, Clone)]
pub struct LogQuery {
    pub levels: Option<Vec<String>>,
    pub search: Option<String>,
    pub step_index: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Flattened projection of a stored record, for the UI only.
///
/// This is the shape the browser renders; it is not what the `logs` view
/// exposes, which stays exactly the OTel field set.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct LogRecordView {
    pub timestamp: String,
    pub severity_number: u8,
    pub severity_text: String,
    pub body: String,
    pub trace_id: String,
    pub span_id: String,
    pub run_id: i64,
    pub job_id: String,
    pub step_index: i64,
    pub step_name: String,
    pub stream: String,
}

/// Result of an ad-hoc SQL query in the explorer.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SqlResult {
    pub columns: Vec<String>,
    /// Every cell rendered as text so any column type survives the boundary.
    pub rows: Vec<Vec<Option<String>>>,
    pub row_count: usize,
}

const DEFAULT_LIMIT: i64 = 2000;

// ── Paths ────────────────────────────────────────────────────────────────────

/// Directory holding one run's per-job log files.
pub fn run_log_dir(repo_path: &str, run_id: i64) -> PathBuf {
    Path::new(repo_path)
        .join(".treq")
        .join("runs")
        .join(run_id.to_string())
}

/// Path of a single job's log file, relative to the repo root.
pub fn job_log_relative_path(run_id: i64, job_id: &str) -> String {
    format!(".treq/runs/{}/{}.jsonl", run_id, sanitize_job_id(job_id))
}

/// Job IDs come from user-authored YAML, so keep them to a safe filename charset.
fn sanitize_job_id(job_id: &str) -> String {
    job_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

// ── Level inference ──────────────────────────────────────────────────────────

/// Classify a line by content.
///
/// Deliberately not keyed on the stream: plenty of tools (cargo, npm) write
/// ordinary progress to stderr, so treating stderr as an error would paint
/// most of a healthy run red.
pub fn infer_level(message: &str) -> &'static str {
    let lower = message.to_lowercase();

    let error_markers = [
        "error",
        "error:",
        "fatal",
        "panic",
        "failed",
        "failure",
        "exception",
        "traceback",
    ];
    let warn_markers = ["warning", "warn:", "deprecated"];

    if error_markers.iter().any(|m| lower.contains(m)) {
        return "error";
    }
    if warn_markers.iter().any(|m| lower.contains(m)) {
        return "warning";
    }
    "info"
}

/// Remove ANSI SGR/CSI escape sequences so stored text renders cleanly.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Consume "[ ... <final byte>" of a CSI sequence.
            if chars.peek() == Some(&'[') {
                chars.next();
                for c2 in chars.by_ref() {
                    if c2.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

// ── Writing ──────────────────────────────────────────────────────────────────

/// Append-only JSONL sink shared by a job's stdout and stderr reader threads.
#[derive(Clone)]
pub struct LogWriter {
    inner: Arc<Mutex<std::io::BufWriter<std::fs::File>>>,
}

impl LogWriter {
    pub fn create(repo_path: &str, run_id: i64, job_id: &str) -> Result<Self, String> {
        let dir = run_log_dir(repo_path, run_id);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create log directory: {}", e))?;
        let path = dir.join(format!("{}.jsonl", sanitize_job_id(job_id)));
        let file = std::fs::File::create(&path)
            .map_err(|e| format!("Failed to create log file: {}", e))?;
        Ok(Self {
            inner: Arc::new(Mutex::new(std::io::BufWriter::new(file))),
        })
    }

    pub fn write_line(&self, line: &LogLine) -> Result<(), String> {
        let json = serde_json::to_string(line)
            .map_err(|e| format!("Failed to serialize log line: {}", e))?;
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "Log writer mutex poisoned".to_string())?;
        writeln!(guard, "{}", json).map_err(|e| format!("Failed to write log line: {}", e))
    }

    pub fn flush(&self) -> Result<(), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "Log writer mutex poisoned".to_string())?;
        guard
            .flush()
            .map_err(|e| format!("Failed to flush log file: {}", e))
    }
}
// ── Querying (DuckDB) ────────────────────────────────────────────────────────

/// Escape a path for embedding in a DuckDB single-quoted string literal.
fn sql_quote(value: &str) -> String {
    value.replace('\'', "''")
}

/// Projection feeding the UI's flat row struct.
///
/// This is internal plumbing, not the `logs` view: the view exposes only the
/// OTel field set, so treq-specific values are read out of `attributes` here.
const UI_PROJECTION: &str = "SELECT
      CAST(timestamp AS VARCHAR) AS timestamp,
      CAST(severityNumber AS INTEGER) AS severity_number,
      CAST(severityText AS VARCHAR) AS severity_text,
      CAST(body.message AS VARCHAR) AS body,
      CAST(traceId AS VARCHAR) AS trace_id,
      CAST(spanId AS VARCHAR) AS span_id,
      CAST(attributes.run_id AS BIGINT) AS run_id,
      CAST(attributes.job_id AS VARCHAR) AS job_id,
      CAST(attributes.step_index AS BIGINT) AS step_index,
      CAST(attributes.step_name AS VARCHAR) AS step_name,
      CAST(attributes['log.iostream'] AS VARCHAR) AS stream";

/// Shared WHERE builder for the single-job and cross-run readers.
///
/// `levels` carries UI names (info/warning/error); they are translated to OTel
/// severity text here so the stored records stay standard.
fn build_where_clause(query: &LogQuery) -> String {
    let mut conditions: Vec<String> = Vec::new();

    if let Some(levels) = query.levels.as_ref().filter(|l| !l.is_empty()) {
        let list = levels
            .iter()
            .map(|l| format!("'{}'", sql_quote(severity_text_for_level(l))))
            .collect::<Vec<_>>()
            .join(", ");
        conditions.push(format!("severityText IN ({})", list));
    }
    if let Some(search) = query.search.as_ref().filter(|s| !s.is_empty()) {
        conditions.push(format!(
            "lower(body.message) LIKE '%{}%'",
            sql_quote(&search.to_lowercase())
        ));
    }
    if let Some(step_index) = query.step_index {
        conditions.push(format!("attributes.step_index = {}", step_index));
    }

    if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    }
}

/// Map a projected row onto the flat view struct.
fn row_to_record(row: &duckdb::Row<'_>) -> duckdb::Result<LogRecordView> {
    Ok(LogRecordView {
        timestamp: row.get(0)?,
        severity_number: row.get::<_, i32>(1)? as u8,
        severity_text: row.get(2)?,
        body: row.get(3)?,
        trace_id: row.get(4)?,
        span_id: row.get(5)?,
        run_id: row.get(6)?,
        job_id: row.get(7)?,
        step_index: row.get(8)?,
        step_name: row.get(9)?,
        stream: row.get(10)?,
    })
}

/// Read a job's log file, applying the browser's filters.
///
/// Returns an empty vec when the file is missing or empty — a job that produced
/// no output is a normal state, not an error.
pub fn query_logs(absolute_log_path: &str, query: &LogQuery) -> Result<Vec<LogRecordView>, String> {
    let path = Path::new(absolute_log_path);
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() == 0 => return Ok(vec![]),
        Ok(_) => {}
        Err(_) => return Ok(vec![]),
    }

    let conn = duckdb::Connection::open_in_memory()
        .map_err(|e| format!("Failed to open DuckDB connection: {}", e))?;

    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 100_000);
    let offset = query.offset.unwrap_or(0).max(0);
    let sql = format!(
        "SELECT * FROM ({} FROM read_json_auto('{}', format='newline_delimited') {}) AS records
         ORDER BY timestamp, step_index LIMIT {} OFFSET {}",
        UI_PROJECTION,
        sql_quote(absolute_log_path),
        build_where_clause(query),
        limit,
        offset
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare log query: {}", e))?;
    let rows = stmt
        .query_map([], row_to_record)
        .map_err(|e| format!("Failed to query logs: {}", e))?;

    rows.collect::<duckdb::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read log rows: {}", e))
}

// ── Repo-wide data source ────────────────────────────────────────────────────

/// Glob covering every job log in the repo.
fn runs_glob(repo_path: &str) -> String {
    Path::new(repo_path)
        .join(".treq")
        .join("runs")
        .join("*")
        .join("*.jsonl")
        .to_string_lossy()
        .to_string()
}

/// True when at least one log file exists, so callers can skip DuckDB entirely.
fn has_any_logs(repo_path: &str) -> bool {
    let runs_dir = Path::new(repo_path).join(".treq").join("runs");
    let Ok(entries) = std::fs::read_dir(&runs_dir) else {
        return false;
    };
    entries.filter_map(|e| e.ok()).any(|run_dir| {
        std::fs::read_dir(run_dir.path())
            .map(|mut files| {
                files.any(|f| {
                    f.ok()
                        .map(|f| f.file_name().to_string_lossy().ends_with(".jsonl"))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

/// SQL defining the `logs` view.
///
/// Deliberately a passthrough: the view exposes exactly the OpenTelemetry log
/// fields as stored, with no treq-specific columns bolted on. Anything
/// treq-specific is reachable through `attributes`.
fn logs_view_sql(repo_path: &str) -> String {
    format!(
        "CREATE OR REPLACE VIEW logs AS
         SELECT timestamp, observedTimestamp, traceId, spanId, traceFlags,
                severityText, severityNumber, body, resource,
                instrumentationScope, attributes, eventName
         FROM read_json_auto('{}', format='newline_delimited')",
        sql_quote(&runs_glob(repo_path))
    )
}

/// Open an in-memory DuckDB with the `logs` view registered.
fn connect_with_logs_view(repo_path: &str) -> Result<duckdb::Connection, String> {
    let conn = duckdb::Connection::open_in_memory()
        .map_err(|e| format!("Failed to open DuckDB connection: {}", e))?;
    conn.execute_batch(&logs_view_sql(repo_path))
        .map_err(|e| format!("Failed to register logs view: {}", e))?;
    Ok(conn)
}

/// Browse log records across every run in the repo.
pub fn query_repo_logs(repo_path: &str, query: &LogQuery) -> Result<Vec<LogRecordView>, String> {
    if !has_any_logs(repo_path) {
        return Ok(vec![]);
    }
    let conn = connect_with_logs_view(repo_path)?;

    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 100_000);
    let offset = query.offset.unwrap_or(0).max(0);
    let sql = format!(
        "SELECT * FROM ({} FROM logs {}) AS records
         ORDER BY run_id DESC, timestamp, step_index LIMIT {} OFFSET {}",
        UI_PROJECTION,
        build_where_clause(query),
        limit,
        offset
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare repo log query: {}", e))?;
    let rows = stmt
        .query_map([], row_to_record)
        .map_err(|e| format!("Failed to query repo logs: {}", e))?;

    rows.collect::<duckdb::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read repo log rows: {}", e))
}

// ── Timeseries ───────────────────────────────────────────────────────────────

/// One chart bucket: a time slot and how many records of each severity landed
/// in it.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct LogBucket {
    pub bucket: String,
    pub severity_text: String,
    pub count: i64,
}

/// Count records per time bucket and severity, for the chart above the feed.
///
/// The bucket width is caller-supplied because the useful resolution depends on
/// how much history is on screen.
pub fn query_log_timeseries(
    repo_path: &str,
    query: &LogQuery,
    bucket_seconds: i64,
) -> Result<Vec<LogBucket>, String> {
    if !has_any_logs(repo_path) {
        return Ok(vec![]);
    }
    let conn = connect_with_logs_view(repo_path)?;
    let width = bucket_seconds.clamp(1, 86_400);

    // Truncate (not round) to the bucket: CAST to BIGINT rounds to the
    // nearest integer in DuckDB, which would push a .5s+ timestamp into the
    // next bucket. floor() truncates toward the earlier bucket instead.
    let sql = format!(
        "SELECT strftime(
                  to_timestamp(floor(epoch(CAST(timestamp AS TIMESTAMP)) / {w}) * {w}),
                  '%Y-%m-%dT%H:%M:%SZ') AS bucket,
                severityText AS severity_text,
                count(*) AS n
         FROM logs {}
         GROUP BY bucket, severity_text
         ORDER BY bucket, severity_text",
        build_where_clause(query),
        w = width
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare timeseries query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LogBucket {
                bucket: row.get(0)?,
                severity_text: row.get(1)?,
                count: row.get(2)?,
            })
        })
        .map_err(|e| format!("Failed to query timeseries: {}", e))?;

    rows.collect::<duckdb::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read timeseries rows: {}", e))
}

// ── Logs explorer ────────────────────────────────────────────────────────────

/// Statement kinds the explorer will run. Everything else is rejected so a
/// stray COPY/ATTACH/INSTALL can't write files or pull in extensions.
const ALLOWED_SQL_PREFIXES: [&str; 6] =
    ["select", "with", "describe", "show", "explain", "summarize"];

/// Reject anything that isn't a single read-only statement.
fn validate_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() {
        return Err("Query is empty".to_string());
    }
    // One statement only: a second one could smuggle in a write.
    if trimmed.contains(';') {
        return Err("Only a single statement can be run at a time".to_string());
    }

    let lower = trimmed.to_lowercase();
    if !ALLOWED_SQL_PREFIXES
        .iter()
        .any(|p| lower.starts_with(p) && lower[p.len()..].starts_with(char::is_whitespace))
    {
        return Err(
            "Only read-only queries are allowed (SELECT, WITH, DESCRIBE, SHOW, EXPLAIN, SUMMARIZE)"
                .to_string(),
        );
    }

    // These can still appear mid-statement, e.g. inside a CTE body.
    let blocked = [
        "attach ", "copy ", "install ", "load ", "export ", "import ", "create ", "insert ",
        "update ", "delete ", "drop ", "alter ",
    ];
    if let Some(word) = blocked.iter().find(|w| lower.contains(*w)) {
        return Err(format!(
            "Statement contains a disallowed keyword: {}",
            word.trim()
        ));
    }
    Ok(())
}

/// Run an ad-hoc read-only query against the `logs` view.
pub fn run_logs_sql(repo_path: &str, sql: &str, max_rows: i64) -> Result<SqlResult, String> {
    validate_sql(sql)?;

    if !has_any_logs(repo_path) {
        return Err(
            "No check logs recorded yet — run a workflow check to populate the logs table."
                .to_string(),
        );
    }

    let conn = connect_with_logs_view(repo_path)?;
    let capped = format!(
        "SELECT * FROM ({}) AS explorer_query LIMIT {}",
        sql.trim().trim_end_matches(';'),
        max_rows.clamp(1, 10_000)
    );

    let mut stmt = conn
        .prepare(&capped)
        .map_err(|e| format!("Query error: {}", e))?;
    let mut rows = stmt.query([]).map_err(|e| format!("Query error: {}", e))?;

    let mut columns: Vec<String> = Vec::new();
    let mut out_rows: Vec<Vec<Option<String>>> = Vec::new();

    while let Some(row) = rows.next().map_err(|e| format!("Query error: {}", e))? {
        if columns.is_empty() {
            columns = row
                .as_ref()
                .column_names()
                .into_iter()
                .map(String::from)
                .collect();
        }
        let mut cells = Vec::with_capacity(columns.len());
        for idx in 0..columns.len() {
            // Everything is stringified; the grid renders text regardless of type.
            let value: Option<String> = row
                .get::<_, Option<String>>(idx)
                .or_else(|_| {
                    row.get::<_, Option<i64>>(idx)
                        .map(|v| v.map(|n| n.to_string()))
                })
                .or_else(|_| {
                    row.get::<_, Option<f64>>(idx)
                        .map(|v| v.map(|n| n.to_string()))
                })
                .or_else(|_| {
                    row.get::<_, Option<bool>>(idx)
                        .map(|v| v.map(|b| b.to_string()))
                })
                .unwrap_or(None);
            cells.push(value);
        }
        out_rows.push(cells);
    }

    // A zero-row result still needs its header, which the loop above never saw.
    if columns.is_empty() {
        columns = stmt.column_names().into_iter().map(String::from).collect();
    }

    let row_count = out_rows.len();
    Ok(SqlResult {
        columns,
        rows: out_rows,
        row_count,
    })
}

/// Render a job's logs as a plain text file suitable for sharing.
pub fn export_logs(absolute_log_path: &str, dest_path: &str) -> Result<String, String> {
    let lines = query_logs(
        absolute_log_path,
        &LogQuery {
            limit: Some(100_000),
            ..Default::default()
        },
    )?;

    let mut out = String::new();
    for line in &lines {
        out.push_str(&format!(
            "{}  [{}] {}\n",
            line.timestamp, line.severity_text, line.body
        ));
    }

    if let Some(parent) = Path::new(dest_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create export directory: {}", e))?;
    }
    std::fs::write(dest_path, out).map_err(|e| format!("Failed to write export file: {}", e))?;
    Ok(dest_path.to_string())
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Fixed epoch base so bucketing assertions stay deterministic.
    const BASE_NANOS: u64 = 1_785_000_000_000_000_000;

    fn sample_line(step_index: i64, level: &str, message: &str) -> LogLine {
        sample_line_at(
            BASE_NANOS + (step_index as u64) * 1_000_000_000,
            step_index,
            level,
            message,
        )
    }

    fn sample_line_at(nanos: u64, step_index: i64, level: &str, message: &str) -> LogLine {
        make_log_line(
            format_timestamp(nanos),
            1,
            "job",
            step_index,
            &format!("step {}", step_index),
            "stdout",
            level,
            message,
        )
    }

    fn write_log(dir: &TempDir, lines: &[LogLine]) -> String {
        let writer = LogWriter::create(&dir.path().to_string_lossy(), 1, "job").unwrap();
        for line in lines {
            writer.write_line(line).unwrap();
        }
        writer.flush().unwrap();
        dir.path()
            .join(".treq/runs/1/job.jsonl")
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn test_infer_level_classifies_errors_and_warnings() {
        assert_eq!(infer_level("error: build failed"), "error");
        assert_eq!(infer_level("warning: unused variable"), "warning");
        assert_eq!(infer_level("Compiling treq v0.1.3"), "info");
    }

    #[test]
    fn test_strip_ansi_removes_color_codes() {
        assert_eq!(strip_ansi("\u{1b}[31mred\u{1b}[0m text"), "red text");
        assert_eq!(strip_ansi("plain text"), "plain text");
    }

    #[test]
    fn test_sanitize_job_id_replaces_path_characters() {
        assert_eq!(sanitize_job_id("../escape"), "___escape");
        assert_eq!(sanitize_job_id("build-job_1"), "build-job_1");
    }

    #[test]
    fn test_query_logs_returns_empty_for_missing_file() {
        let result = query_logs("/nonexistent/path/logs.jsonl", &LogQuery::default()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_query_logs_reads_written_lines() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "hello"),
                sample_line(1, "error", "boom"),
            ],
        );
        let result = query_logs(&path, &LogQuery::default()).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].body, "hello");
    }

    #[test]
    fn test_query_logs_filters_by_level() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "hello"),
                sample_line(1, "error", "boom"),
            ],
        );
        let result = query_logs(
            &path,
            &LogQuery {
                levels: Some(vec!["error".to_string()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].body, "boom");
    }

    #[test]
    fn test_query_logs_filters_by_search_and_step() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "compiling crate"),
                sample_line(1, "info", "linking binary"),
            ],
        );
        let by_search = query_logs(
            &path,
            &LogQuery {
                search: Some("LINKING".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_search.len(), 1);

        let by_step = query_logs(
            &path,
            &LogQuery {
                step_index: Some(0),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_step.len(), 1);
    }

    #[test]
    fn test_query_logs_filters_by_multiple_levels() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "hello"),
                sample_line(1, "warning", "careful"),
                sample_line(2, "error", "boom"),
            ],
        );
        let result = query_logs(
            &path,
            &LogQuery {
                levels: Some(vec!["warning".to_string(), "error".to_string()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|l| l.severity_text != "INFO"));
    }

    #[test]
    fn test_empty_levels_list_does_not_filter() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "hello"),
                sample_line(1, "error", "boom"),
            ],
        );
        let result = query_logs(
            &path,
            &LogQuery {
                levels: Some(vec![]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_query_repo_logs_spans_runs_with_ids() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path().to_string_lossy().to_string();
        for run_id in [1i64, 2i64] {
            let writer = LogWriter::create(&repo, run_id, "build").unwrap();
            writer
                .write_line(&make_log_line(
                    format_timestamp(BASE_NANOS),
                    run_id,
                    "build",
                    0,
                    "step 0",
                    "stdout",
                    "info",
                    &format!("run {}", run_id),
                ))
                .unwrap();
            writer.flush().unwrap();
        }

        let result = query_repo_logs(&repo, &LogQuery::default()).unwrap();
        assert_eq!(result.len(), 2);
        // Newest run first, and run/job identity is recovered from the path.
        assert_eq!(result[0].run_id, 2);
        assert_eq!(result[0].job_id, "build");
    }

    #[test]
    fn test_query_repo_logs_empty_without_runs() {
        let dir = TempDir::new().unwrap();
        let result = query_repo_logs(&dir.path().to_string_lossy(), &LogQuery::default()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_validate_sql_rejects_writes_and_multiple_statements() {
        assert!(validate_sql("SELECT * FROM logs").is_ok());
        assert!(validate_sql("WITH x AS (SELECT 1) SELECT * FROM x").is_ok());
        assert!(validate_sql("DROP TABLE logs").is_err());
        assert!(validate_sql("SELECT 1; DROP TABLE logs").is_err());
        assert!(validate_sql("COPY logs TO '/tmp/out.csv'").is_err());
        assert!(validate_sql("").is_err());
    }

    #[test]
    fn test_run_logs_sql_returns_columns_and_rows() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path().to_string_lossy().to_string();
        let writer = LogWriter::create(&repo, 1, "build").unwrap();
        writer.write_line(&sample_line(0, "error", "boom")).unwrap();
        writer.write_line(&sample_line(1, "info", "fine")).unwrap();
        writer.flush().unwrap();

        let result = run_logs_sql(
            &repo,
            "SELECT severityText, count(*) AS n FROM logs GROUP BY severityText ORDER BY severityText",
            100,
        )
        .unwrap();
        assert_eq!(result.columns, vec!["severityText", "n"]);
        assert_eq!(result.row_count, 2);
    }

    #[test]
    fn test_run_logs_sql_rejects_disallowed_statement() {
        let dir = TempDir::new().unwrap();
        let err = run_logs_sql(&dir.path().to_string_lossy(), "DELETE FROM logs", 100).unwrap_err();
        assert!(err.contains("read-only"));
    }

    #[test]
    fn test_records_are_written_in_otel_shape() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path().to_string_lossy().to_string();
        let writer = LogWriter::create(&repo, 7, "build").unwrap();
        writer
            .write_line(&make_log_line(
                format_timestamp(BASE_NANOS),
                7,
                "build",
                2,
                "Compile",
                "stderr",
                "error",
                "boom",
            ))
            .unwrap();
        writer.flush().unwrap();

        let raw = std::fs::read_to_string(dir.path().join(".treq/runs/7/build.jsonl")).unwrap();
        let json: serde_json::Value = serde_json::from_str(raw.trim()).unwrap();

        // Exactly the OTel log data model, camelCased, and nothing else.
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        keys.sort();
        assert_eq!(
            keys,
            vec![
                "attributes",
                "body",
                "eventName",
                "instrumentationScope",
                "observedTimestamp",
                "resource",
                "severityNumber",
                "severityText",
                "spanId",
                "timestamp",
                "traceFlags",
                "traceId",
            ]
        );

        assert_eq!(json["severityText"], "ERROR");
        assert_eq!(json["severityNumber"], 17);
        assert_eq!(json["body"]["message"], "boom");
        assert_eq!(json["eventName"], "check.step.output");
        assert_eq!(json["traceFlags"], 1);
        assert_eq!(json["resource"]["service.name"], "treq");
        assert_eq!(json["instrumentationScope"]["name"], "treq.checks");
        assert_eq!(json["attributes"]["run_id"], 7);
        assert_eq!(json["attributes"]["job_id"], "build");
        assert_eq!(json["attributes"]["step_index"], 2);
        assert_eq!(json["attributes"]["log.iostream"], "stderr");
        assert_eq!(json["traceId"].as_str().unwrap().len(), 32);
        assert_eq!(json["spanId"].as_str().unwrap().len(), 16);
        assert_eq!(json["timestamp"], json["observedTimestamp"]);
        assert!(json["timestamp"].as_str().unwrap().ends_with("Z"));
    }

    #[test]
    fn test_severity_mapping_covers_all_levels() {
        assert_eq!(severity_text_for_level("info"), "INFO");
        assert_eq!(severity_text_for_level("warning"), "WARN");
        assert_eq!(severity_text_for_level("error"), "ERROR");
        assert_eq!(severity_number_for_text("INFO"), 9);
        assert_eq!(severity_number_for_text("WARN"), 13);
        assert_eq!(severity_number_for_text("ERROR"), 17);
    }

    #[test]
    fn test_trace_id_is_per_run_and_span_id_per_job() {
        assert_eq!(trace_id_for_run(1), trace_id_for_run(1));
        assert_ne!(trace_id_for_run(1), trace_id_for_run(2));
        assert_ne!(span_id_for_job(1, "build"), span_id_for_job(1, "test"));
    }

    #[test]
    fn test_query_log_timeseries_buckets_by_severity() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path().to_string_lossy().to_string();
        let writer = LogWriter::create(&repo, 1, "build").unwrap();
        // Two errors in the first second, one info in the next.
        writer
            .write_line(&sample_line_at(BASE_NANOS, 0, "error", "a"))
            .unwrap();
        writer
            .write_line(&sample_line_at(BASE_NANOS + 1, 0, "error", "b"))
            .unwrap();
        writer
            .write_line(&sample_line_at(BASE_NANOS + 2_000_000_000, 1, "info", "c"))
            .unwrap();
        writer.flush().unwrap();

        let buckets = query_log_timeseries(&repo, &LogQuery::default(), 1).unwrap();
        let errors: i64 = buckets
            .iter()
            .filter(|b| b.severity_text == "ERROR")
            .map(|b| b.count)
            .sum();
        let infos: i64 = buckets
            .iter()
            .filter(|b| b.severity_text == "INFO")
            .map(|b| b.count)
            .sum();
        assert_eq!(errors, 2);
        assert_eq!(infos, 1);
        // The two errors share a bucket, the info lands in a later one.
        assert!(buckets.len() >= 2);
    }

    #[test]
    fn test_timeseries_truncates_fractional_seconds_not_rounds() {
        // Both lines fall in the same integer second, but one is past the
        // half-second mark. A rounding bucket (rather than a floor) would push
        // it into the next second and split what should be one bucket in two.
        let dir = TempDir::new().unwrap();
        let repo = dir.path().to_string_lossy().to_string();
        let writer = LogWriter::create(&repo, 1, "build").unwrap();
        writer
            .write_line(&sample_line_at(BASE_NANOS + 100_000_000, 0, "info", "a"))
            .unwrap();
        writer
            .write_line(&sample_line_at(BASE_NANOS + 700_000_000, 0, "info", "b"))
            .unwrap();
        writer.flush().unwrap();

        let buckets = query_log_timeseries(&repo, &LogQuery::default(), 1).unwrap();
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].count, 2);
    }

    #[test]
    fn test_timeseries_empty_without_runs() {
        let dir = TempDir::new().unwrap();
        let buckets =
            query_log_timeseries(&dir.path().to_string_lossy(), &LogQuery::default(), 1).unwrap();
        assert!(buckets.is_empty());
    }

    #[test]
    fn test_logs_view_exposes_otel_columns() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path().to_string_lossy().to_string();
        let writer = LogWriter::create(&repo, 1, "build").unwrap();
        writer.write_line(&sample_line(0, "info", "hello")).unwrap();
        writer.flush().unwrap();

        let result = run_logs_sql(
            &repo,
            "SELECT timestamp, severityText, body.message AS message, attributes.run_id AS run_id FROM logs",
            10,
        )
        .unwrap();
        assert_eq!(
            result.columns,
            vec!["timestamp", "severityText", "message", "run_id"]
        );
        assert_eq!(result.row_count, 1);
    }

    #[test]
    fn test_export_logs_writes_plain_text() {
        let dir = TempDir::new().unwrap();
        let path = write_log(
            &dir,
            &[
                sample_line(0, "info", "hello"),
                sample_line(1, "error", "boom"),
            ],
        );
        let dest = dir.path().join("out.log").to_string_lossy().to_string();
        export_logs(&path, &dest).unwrap();
        let contents = std::fs::read_to_string(&dest).unwrap();
        assert!(contents.contains("[ERROR] boom"));
        assert_eq!(contents.lines().count(), 2);
    }
}
