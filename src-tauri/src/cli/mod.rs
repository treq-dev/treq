use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;
use tauri_plugin_cli::{Matches, SubcommandMatches};

use crate::agent_dispatch;
use crate::binary_paths;
use crate::core;
use crate::db::Database;
use crate::local_db;

pub(super) fn normalize_repo_path(path: &Path) -> String {
  std::fs::canonicalize(path)
    .ok()
    .and_then(|p| p.to_str().map(|s| s.to_string()))
    .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Walk up from CWD to find a directory containing `.git`.
pub fn detect_repo_path() -> Result<String, String> {
  let cwd = std::env::current_dir().map_err(|e| format!("Failed to get CWD: {}", e))?;

  let mut dir = cwd.as_path();
  loop {
    if dir.join(".git").is_dir() {
      return Ok(normalize_repo_path(dir));
    }
    match dir.parent() {
      Some(parent) => dir = parent,
      None => break,
    }
  }

  Err("Not inside a git repository (no .git directory found)".to_string())
}

/// Directory name under `.treq/workspaces/` when `cwd` is inside a workspace.
pub(super) fn workspace_dir_name_from_cwd(cwd: &Path) -> Option<String> {
  let mut current = cwd;
  loop {
    let parent = current.parent()?;
    if parent.file_name() == Some(std::ffi::OsStr::new("workspaces")) {
      let treq = parent.parent()?;
      if treq.file_name() == Some(std::ffi::OsStr::new(".treq")) {
        return current
          .file_name()
          .and_then(|name| name.to_str())
          .map(|name| name.to_string());
      }
    }
    current = parent;
  }
}

pub(super) fn lookup_workspace_from_cwd(repo_path: &str) -> Option<local_db::Workspace> {
  let cwd = std::env::current_dir().ok()?;
  let name = workspace_dir_name_from_cwd(&cwd)?;
  local_db::get_workspace_by_path(repo_path, &name)
    .ok()
    .flatten()
}

/// Initialize binary paths cache for CLI mode (no database needed).
pub fn init_cli_binary_paths() {
  let mut paths = HashMap::new();
  for name in ["jj", "git"] {
    if let Some(path) = binary_paths::detect_binary(name) {
      paths.insert(name.to_string(), path);
    }
  }
  binary_paths::init_binary_paths_cache(paths);
}

/// Top-level CLI dispatch. Returns the process exit code if the subcommand was
/// recognized, or `None` if it was not (caller should print usage and exit).
pub fn handle_cli_command(subcommand: &SubcommandMatches) -> Option<i32> {
  let success = match subcommand.name.as_str() {
    "add" => workspace_handlers::handle_workspace_add(&subcommand.matches),
    "set" => workspace_handlers::handle_workspace_set(&subcommand.matches),
    "st" => workspace_handlers::handle_workspace_status(&subcommand.matches),
    "diff" => workspace_handlers::handle_workspace_diff(&subcommand.matches),
    "mv" => workspace_handlers::handle_workspace_move(&subcommand.matches),
    "agent" => workspace_handlers::handle_workspace_agent(&subcommand.matches),
    "commit" => workspace_handlers::handle_workspace_commit(&subcommand.matches),
    "resolve" => workspace_handlers::handle_resolve(&subcommand.matches),
    "send" => workspace_handlers::handle_send(&subcommand.matches),
    "help" => {
      print_cli_help();
      true
    }
    _ => return None,
  };
  Some(if success { 0 } else { 1 })
}

/// Prints an error to stderr and records it in the app's log file.
pub(super) fn log_cli_error(msg: &str) {
  eprintln!("{}", msg);
  tracing::error!("{}", msg);
}

/// Handles top-level CLI args that do not map to subcommands.
/// Returns `true` when an arg is consumed and no GUI should be opened.
pub fn handle_cli_global_args(matches: &Matches) -> bool {
  if let Some(help_text) = matches.args.get("help").and_then(|arg| arg.value.as_str()) {
    println!("{}", help_text);
    return true;
  }

  if matches.args.contains_key("version") {
    println!("treq {}", env!("CARGO_PKG_VERSION"));
    return true;
  }

  false
}

fn print_cli_help() {
  println!("Treq - Stacking ADE");
  println!();
  println!("Usage:");
  println!("  treq add <branch_name> [-d description] [-l title] [-s source_branch] [-p sparse]... [-k symlink]...");
  println!("  treq set <workspace_name> [-d description] [-l title] [-t target_branch]");
  println!("  treq st [workspace_name]");
  println!("  treq diff [workspace_name]");
  println!(
        "  treq mv <source> <destination> -f [FILES...] -r [RANGES...] -c [COMMITS...]  (use '.' for the home repo)"
    );
  println!("  treq agent <branch> <prompt> [-m <edit|plan>]");
  println!("  treq commit <workspace_name> -m <message> [--push]");
  println!("  treq resolve <commit_id> [sides...]");
  println!("  treq send [path|-]");
  println!("  treq send --browser <path-or-url>");
  println!("  treq help");
}

pub(super) fn parse_agent_mode(mode: &str) -> Result<&'static str, String> {
  match mode.trim() {
    "edit" => Ok("acceptEdits"),
    "plan" => Ok("plan"),
    other => Err(format!(
      "invalid mode '{}'. Expected one of: edit, plan",
      other
    )),
  }
}

pub(super) fn parse_agent_mode_or_default(mode: Option<&str>) -> Result<&'static str, String> {
  match mode {
    Some(value) => parse_agent_mode(value),
    None => Ok("acceptEdits"),
  }
}

fn get_db_setting(db: &Database, key: &str) -> Option<String> {
  db.get_setting(key)
    .ok()
    .flatten()
    .map(|v| v.trim().to_string())
    .filter(|v| !v.is_empty())
}

pub(super) fn resolve_default_agent(repo_path: &str) -> String {
  let db_path = core::resolve_app_db_path(repo_path);
  let Ok(db) = Database::new(db_path) else {
    return "claude".to_string();
  };

  db.get_repo_setting(repo_path, "default_agent")
    .ok()
    .flatten()
    .map(|v| v.trim().to_string())
    .filter(|v| !v.is_empty())
    .or_else(|| get_db_setting(&db, "default_agent"))
    .unwrap_or_else(|| "claude".to_string())
}

pub(super) fn dispatch_agent_request(
  repo_path: &str,
  branch: &str,
  prompt: &str,
  mode: &str,
  agent: &str,
  request_id: &str,
) -> Result<(), String> {
  let now = agent_dispatch::now_millis();
  local_db::prune_stale_instance_registry(repo_path, now, agent_dispatch::HEARTBEAT_TIMEOUT_MS)?;
  let instances = local_db::list_instance_registry(repo_path)?;

  let instance =
    agent_dispatch::resolve_target_instance(&instances, repo_path).ok_or_else(|| {
      format!(
        "No running Treq instance has repo '{}'. Open this repo in Treq first.",
        repo_path
      )
    })?;

  let request = agent_dispatch::AgentDispatchRequest {
    request_id: request_id.to_string(),
    repo: repo_path.to_string(),
    branch: branch.to_string(),
    prompt: prompt.to_string(),
    mode: mode.to_string(),
    agent: agent.to_string(),
  };
  let response = agent_dispatch::send_dispatch_request(
    &instance.endpoint,
    &request,
    Duration::from_millis(250),
    Duration::from_millis(600),
  )?;
  if response.status == "handled" {
    return Ok(());
  }
  Err(format!(
    "Agent request not handled by instance '{}': {}",
    instance.instance_id,
    response
      .reason
      .unwrap_or_else(|| "unknown dispatch failure".to_string())
  ))
}

pub(super) fn dispatch_send_request(
  request: &crate::send_dispatch::SendDispatchRequest,
) -> Result<(), String> {
  let now = agent_dispatch::now_millis();
  local_db::prune_stale_instance_registry(
    &request.repo,
    now,
    agent_dispatch::HEARTBEAT_TIMEOUT_MS,
  )?;
  let instances = local_db::list_instance_registry(&request.repo)?;

  let instance =
    agent_dispatch::resolve_target_instance(&instances, &request.repo).ok_or_else(|| {
      format!(
        "No running Treq instance has repo '{}'. Open this repo in Treq first.",
        request.repo
      )
    })?;

  let response = send_json_dispatch_request(
    &instance.endpoint,
    request,
    Duration::from_millis(250),
    Duration::from_millis(600),
  )?;
  if response.status == "handled" {
    return Ok(());
  }
  Err(format!(
    "Send request not handled by instance '{}': {}",
    instance.instance_id,
    response
      .reason
      .unwrap_or_else(|| "unknown dispatch failure".to_string())
  ))
}

fn send_json_dispatch_request<T: serde::Serialize>(
  endpoint: &str,
  request: &T,
  connect_timeout: Duration,
  io_timeout: Duration,
) -> Result<agent_dispatch::AgentDispatchResponse, String> {
  use std::io::{Read, Write};
  use std::net::{Shutdown, TcpStream};

  let addr = endpoint
    .parse()
    .map_err(|e| format!("invalid endpoint '{}': {}", endpoint, e))?;
  let mut stream = TcpStream::connect_timeout(&addr, connect_timeout)
    .map_err(|e| format!("failed to connect to endpoint {}: {}", endpoint, e))?;

  stream
    .set_read_timeout(Some(io_timeout))
    .map_err(|e| format!("failed to set read timeout: {}", e))?;
  stream
    .set_write_timeout(Some(io_timeout))
    .map_err(|e| format!("failed to set write timeout: {}", e))?;

  let payload = serde_json::to_vec(request)
    .map_err(|e| format!("failed to serialize dispatch request: {}", e))?;
  stream
    .write_all(&payload)
    .map_err(|e| format!("failed to send dispatch request: {}", e))?;
  stream
    .shutdown(Shutdown::Write)
    .map_err(|e| format!("failed to finish dispatch write: {}", e))?;

  let mut response = String::new();
  stream
    .read_to_string(&mut response)
    .map_err(|e| format!("failed reading dispatch response: {}", e))?;

  serde_json::from_str::<agent_dispatch::AgentDispatchResponse>(response.trim())
    .map_err(|e| format!("invalid dispatch response payload: {}", e))
}

mod workspace_handlers;

mod status_output;

#[cfg(test)]
mod tests;
