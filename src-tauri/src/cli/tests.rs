use super::{
  dispatch_agent_request, handle_cli_command, handle_cli_global_args, normalize_repo_path,
  parse_agent_mode, parse_agent_mode_or_default, workspace_dir_name_from_cwd,
};
use crate::agent_dispatch;
use crate::local_db;
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri_plugin_cli::{Matches, SubcommandMatches};
use tempfile::TempDir;

fn make_subcommand(name: &str) -> SubcommandMatches {
  let mut sub = SubcommandMatches::default();
  sub.name = name.to_string();
  sub.matches = Matches::default();
  sub
}

#[test]
fn help_is_handled_by_cli_dispatch() {
  let subcommand = make_subcommand("help");
  assert!(handle_cli_command(&subcommand).is_some());
}

#[test]
fn unknown_subcommand_is_not_handled_by_cli_dispatch() {
  let subcommand = make_subcommand("open");
  assert!(handle_cli_command(&subcommand).is_none());
}

#[test]
fn commit_is_handled_by_cli_dispatch() {
  let subcommand = make_subcommand("commit");
  assert!(handle_cli_command(&subcommand).is_some());
}

#[test]
fn send_is_handled_by_cli_dispatch() {
  let subcommand = make_subcommand("send");
  assert!(handle_cli_command(&subcommand).is_some());
}

#[test]
fn diff_is_handled_by_cli_dispatch() {
  let subcommand = make_subcommand("diff");
  assert!(handle_cli_command(&subcommand).is_some());
}

#[test]
fn resolve_is_handled_by_cli_dispatch() {
  let subcommand = make_subcommand("resolve");
  assert!(handle_cli_command(&subcommand).is_some());
}

#[test]
fn resolve_subcommand_defines_commit_id_positional() {
  let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
  let config = fs::read_to_string(config_path).expect("failed to read tauri.conf.json");
  let json: Value = serde_json::from_str(&config).expect("failed to parse tauri.conf.json");
  let resolve = json["plugins"]["cli"]["subcommands"]["resolve"]
    .as_object()
    .expect("resolve subcommand must exist");
  let args = resolve
    .get("args")
    .and_then(Value::as_array)
    .expect("resolve args must be an array");

  let commit_id = args
    .iter()
    .find(|arg| arg.get("name").and_then(Value::as_str) == Some("commit_id"))
    .expect("resolve must define commit_id positional arg");
  assert_eq!(commit_id.get("index").and_then(Value::as_i64), Some(1));
  assert_eq!(
    commit_id.get("takesValue").and_then(Value::as_bool),
    Some(true)
  );
  assert_eq!(
    commit_id.get("required").and_then(Value::as_bool),
    Some(true)
  );
}

#[test]
fn send_subcommand_defines_optional_path_positional() {
  let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
  let config = fs::read_to_string(config_path).expect("failed to read tauri.conf.json");
  let json: Value = serde_json::from_str(&config).expect("failed to parse tauri.conf.json");
  let send = json["plugins"]["cli"]["subcommands"]["send"]
    .as_object()
    .expect("send subcommand must exist");
  let args = send
    .get("args")
    .and_then(Value::as_array)
    .expect("send args must be an array");

  let path = args
    .iter()
    .find(|arg| arg.get("name").and_then(Value::as_str) == Some("path"))
    .expect("send must define path positional arg");
  assert_eq!(path.get("index").and_then(Value::as_i64), Some(1));
  assert_eq!(path.get("takesValue").and_then(Value::as_bool), Some(true));
  assert_ne!(path.get("required").and_then(Value::as_bool), Some(true));
}

#[test]
fn diff_subcommand_defines_optional_workspace_name() {
  let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
  let config = fs::read_to_string(config_path).expect("failed to read tauri.conf.json");
  let json: Value = serde_json::from_str(&config).expect("failed to parse tauri.conf.json");
  let diff = json["plugins"]["cli"]["subcommands"]["diff"]
    .as_object()
    .expect("diff subcommand must exist");
  let args = diff
    .get("args")
    .and_then(Value::as_array)
    .expect("diff args must be an array");

  let workspace_name = args
    .iter()
    .find(|arg| arg.get("name").and_then(Value::as_str) == Some("workspace_name"))
    .expect("diff must define workspace_name positional arg");
  assert_eq!(workspace_name.get("index").and_then(Value::as_i64), Some(1));
  assert_eq!(
    workspace_name.get("takesValue").and_then(Value::as_bool),
    Some(true)
  );
  assert_ne!(
    workspace_name.get("required").and_then(Value::as_bool),
    Some(true)
  );
}

#[test]
fn send_subcommand_defines_a_browser_flag() {
  let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
  let config = fs::read_to_string(config_path).expect("failed to read tauri.conf.json");
  let json: Value = serde_json::from_str(&config).expect("failed to parse tauri.conf.json");
  let send = json["plugins"]["cli"]["subcommands"]["send"]
    .as_object()
    .expect("send subcommand must exist");
  let args = send
    .get("args")
    .and_then(Value::as_array)
    .expect("send args must be an array");

  let browser = args
    .iter()
    .find(|arg| arg.get("name").and_then(Value::as_str) == Some("browser"))
    .expect("send must define a browser flag arg");
  assert_ne!(
    browser.get("takesValue").and_then(Value::as_bool),
    Some(true),
    "browser must be a boolean flag, not a value-taking option"
  );
}

#[test]
fn asset_protocol_allows_files_below_hidden_workspace_directories() {
  let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
  let config = fs::read_to_string(config_path).expect("failed to read tauri.conf.json");
  let json: Value = serde_json::from_str(&config).expect("failed to parse tauri.conf.json");
  let scope = &json["app"]["security"]["assetProtocol"]["scope"];

  assert_eq!(
    scope["requireLiteralLeadingDot"].as_bool(),
    Some(false),
    "workspace paths pass through the hidden .treq directory"
  );
}

#[test]
fn top_level_help_arg_is_handled_by_global_dispatch() {
  let mut matches = Matches::default();
  let mut help_arg = tauri_plugin_cli::ArgData::default();
  help_arg.value = Value::String("generated help text".to_string());
  help_arg.occurrences = 0;
  matches.args.insert("help".to_string(), help_arg);

  assert!(handle_cli_global_args(&matches));
}

#[test]
fn no_global_args_are_not_handled() {
  let matches = Matches::default();
  assert!(!handle_cli_global_args(&matches));
}

#[test]
fn top_level_version_arg_is_handled_by_global_dispatch() {
  let mut matches = Matches::default();
  matches
    .args
    .insert("version".to_string(), tauri_plugin_cli::ArgData::default());

  assert!(handle_cli_global_args(&matches));
}

#[test]
fn parse_agent_mode_maps_edit_and_plan() {
  assert_eq!(
    parse_agent_mode("edit").expect("edit mode should parse"),
    "acceptEdits"
  );
  assert_eq!(
    parse_agent_mode("plan").expect("plan mode should parse"),
    "plan"
  );
}

#[test]
fn parse_agent_mode_defaults_to_edit_when_missing() {
  assert_eq!(
    parse_agent_mode_or_default(None).expect("missing mode should default"),
    "acceptEdits"
  );
}

#[test]
fn parse_agent_mode_or_default_uses_explicit_mode() {
  assert_eq!(
    parse_agent_mode_or_default(Some("plan")).expect("plan should parse"),
    "plan"
  );
}

#[test]
fn parse_agent_mode_rejects_invalid_mode() {
  let error = parse_agent_mode("invalid").expect_err("invalid mode must fail");
  assert!(error.contains("invalid mode"));
}

#[test]
fn normalize_repo_path_falls_back_for_missing_path() {
  let missing = Path::new("/definitely/not/present/treq-missing-path");
  let normalized = normalize_repo_path(missing);
  assert_eq!(normalized, missing.to_string_lossy());
}

#[test]
fn workspace_dir_name_from_cwd_reads_treq_workspaces_component() {
  let nested = Path::new("/repo/.treq/workspaces/feat-ui/src/lib");
  assert_eq!(
    workspace_dir_name_from_cwd(nested).as_deref(),
    Some("feat-ui")
  );
  assert_eq!(
    workspace_dir_name_from_cwd(Path::new("/repo/.treq/workspaces/feat-ui")).as_deref(),
    Some("feat-ui")
  );
  assert_eq!(workspace_dir_name_from_cwd(Path::new("/repo/src")), None);
}

#[test]
fn positional_cli_args_take_values_in_tauri_config() {
  let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
  let config = fs::read_to_string(config_path).expect("failed to read tauri.conf.json");
  let json: Value = serde_json::from_str(&config).expect("failed to parse tauri.conf.json");

  let subcommands = json["plugins"]["cli"]["subcommands"]
    .as_object()
    .expect("plugins.cli.subcommands must be an object");

  for (subcommand_name, subcommand) in subcommands {
    let args = match subcommand.get("args").and_then(Value::as_array) {
      Some(args) => args,
      None => continue,
    };

    for arg in args {
      let has_index = arg.get("index").is_some();
      if !has_index {
        continue;
      }

      let takes_value = arg
        .get("takesValue")
        .and_then(Value::as_bool)
        .unwrap_or(false);
      let arg_name = arg
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("<unknown>");

      assert!(
        takes_value,
        "positional arg '{}' in subcommand '{}' must set takesValue=true",
        arg_name, subcommand_name
      );
    }
  }
}

#[test]
fn mv_subcommand_uses_source_and_destination_positionals() {
  let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
  let config = fs::read_to_string(config_path).expect("failed to read tauri.conf.json");
  let json: Value = serde_json::from_str(&config).expect("failed to parse tauri.conf.json");
  let mv = json["plugins"]["cli"]["subcommands"]["mv"]
    .as_object()
    .expect("mv subcommand must exist");
  let args = mv
    .get("args")
    .and_then(Value::as_array)
    .expect("mv args must be an array");

  let source = args
    .iter()
    .find(|arg| arg.get("name").and_then(Value::as_str) == Some("source"))
    .expect("mv must define source positional arg");
  assert_eq!(source.get("index").and_then(Value::as_i64), Some(1));
  assert_eq!(
    source.get("takesValue").and_then(Value::as_bool),
    Some(true)
  );

  let destination = args
    .iter()
    .find(|arg| arg.get("name").and_then(Value::as_str) == Some("destination"))
    .expect("mv must define destination positional arg");
  assert_eq!(destination.get("index").and_then(Value::as_i64), Some(2));
  assert_eq!(
    destination.get("takesValue").and_then(Value::as_bool),
    Some(true)
  );
}

#[test]
fn commit_subcommand_defines_workspace_message_and_push_args() {
  let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
  let config = fs::read_to_string(config_path).expect("failed to read tauri.conf.json");
  let json: Value = serde_json::from_str(&config).expect("failed to parse tauri.conf.json");
  let commit = json["plugins"]["cli"]["subcommands"]["commit"]
    .as_object()
    .expect("commit subcommand must exist");
  let args = commit
    .get("args")
    .and_then(Value::as_array)
    .expect("commit args must be an array");

  let workspace_name = args
    .iter()
    .find(|arg| arg.get("name").and_then(Value::as_str) == Some("workspace_name"))
    .expect("commit must define workspace_name positional arg");
  assert_eq!(workspace_name.get("index").and_then(Value::as_i64), Some(1));
  assert_eq!(
    workspace_name.get("takesValue").and_then(Value::as_bool),
    Some(true)
  );
  assert_eq!(
    workspace_name.get("required").and_then(Value::as_bool),
    Some(true)
  );

  let message = args
    .iter()
    .find(|arg| arg.get("name").and_then(Value::as_str) == Some("message"))
    .expect("commit must define message arg");
  assert_eq!(message.get("short").and_then(Value::as_str), Some("m"));
  assert_eq!(
    message.get("takesValue").and_then(Value::as_bool),
    Some(true)
  );
  assert_eq!(message.get("required").and_then(Value::as_bool), Some(true));

  let push = args
    .iter()
    .find(|arg| arg.get("name").and_then(Value::as_str) == Some("push"))
    .expect("commit must define push arg");
  assert_eq!(push.get("index"), None, "push must not be positional");
  assert_eq!(
    push
      .get("takesValue")
      .and_then(Value::as_bool)
      .unwrap_or(false),
    false,
    "push must be a boolean flag"
  );
}

fn env_lock() -> &'static Mutex<()> {
  static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
  LOCK.get_or_init(|| Mutex::new(()))
}

fn seed_registry(instances: Vec<agent_dispatch::RegisteredInstance>, repo_path: &str) {
  local_db::init_local_db(repo_path).expect("init local db");
  for instance in instances {
    local_db::upsert_instance_registry(repo_path, instance).expect("upsert instance");
  }
}

#[test]
fn dispatch_agent_request_selects_matching_instance_and_handles_ack() {
  let _guard = env_lock().lock().unwrap();
  let temp = TempDir::new().expect("temp");

  let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
  let endpoint = listener.local_addr().unwrap().to_string();
  let handle = thread::spawn(move || {
    let (mut stream, _) = listener.accept().expect("accept");
    let mut payload = String::new();
    stream.read_to_string(&mut payload).expect("read");
    let request: agent_dispatch::AgentDispatchRequest =
      serde_json::from_str(payload.trim()).expect("json");
    assert_eq!(request.branch, "feat/x");
    let response =
      serde_json::to_string(&agent_dispatch::AgentDispatchResponse::handled()).expect("serialize");
    stream.write_all(response.as_bytes()).expect("write");
  });

  let repo = temp.path().join("repo");
  std::fs::create_dir_all(&repo).expect("mkdir");
  let normalized_repo = agent_dispatch::normalize_repo_path(repo.to_str().unwrap());
  seed_registry(
    vec![agent_dispatch::RegisteredInstance {
      instance_id: "instance-1".to_string(),
      pid: 1,
      started_at: 1,
      last_heartbeat_at: agent_dispatch::now_millis(),
      endpoint,
      windows: vec![agent_dispatch::InstanceWindowSnapshot {
        window_label: "main".to_string(),
        normalized_repo_path: normalized_repo,
        focused: true,
        last_focused_at: Some(agent_dispatch::now_millis()),
      }],
    }],
    repo.to_str().unwrap(),
  );

  let result = dispatch_agent_request(
    repo.to_str().unwrap(),
    "feat/x",
    "hello",
    "plan",
    "codex",
    "req-1",
  );
  assert!(result.is_ok());
  handle.join().expect("join");
}

#[test]
fn dispatch_agent_request_returns_error_when_no_matching_instance() {
  let _guard = env_lock().lock().unwrap();
  let temp = TempDir::new().expect("temp");
  let repo = temp.path().join("repo");
  std::fs::create_dir_all(&repo).expect("mkdir");
  seed_registry(vec![], repo.to_str().unwrap());
  let result = dispatch_agent_request(
    "/tmp/unknown-repo",
    "feat/x",
    "hello",
    "plan",
    "codex",
    "req-1",
  );
  assert!(result.is_err());
  assert!(result.unwrap_err().contains("No running Treq instance"));
}

#[test]
fn dispatch_agent_request_surfaces_ack_timeout_error() {
  let _guard = env_lock().lock().unwrap();
  let temp = TempDir::new().expect("temp");

  let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
  let endpoint = listener.local_addr().unwrap().to_string();
  let handle = thread::spawn(move || {
    let (_stream, _) = listener.accept().expect("accept");
    thread::sleep(Duration::from_millis(900));
  });

  let repo = temp.path().join("repo");
  std::fs::create_dir_all(&repo).expect("mkdir");
  let normalized_repo = agent_dispatch::normalize_repo_path(repo.to_str().unwrap());
  seed_registry(
    vec![agent_dispatch::RegisteredInstance {
      instance_id: "instance-timeout".to_string(),
      pid: 1,
      started_at: 1,
      last_heartbeat_at: agent_dispatch::now_millis(),
      endpoint,
      windows: vec![agent_dispatch::InstanceWindowSnapshot {
        window_label: "main".to_string(),
        normalized_repo_path: normalized_repo,
        focused: true,
        last_focused_at: Some(agent_dispatch::now_millis()),
      }],
    }],
    repo.to_str().unwrap(),
  );

  let result = dispatch_agent_request(
    repo.to_str().unwrap(),
    "feat/x",
    "hello",
    "plan",
    "codex",
    "req-1",
  );
  assert!(result.is_err());
  let error = result.unwrap_err();
  assert!(
    error.contains("failed reading dispatch response")
      || error.contains("invalid dispatch response payload")
  );
  handle.join().expect("join");
}
