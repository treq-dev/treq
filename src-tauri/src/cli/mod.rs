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

/// Walk up from CWD to find a directory containing `.treq` or `.git`.
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

/// Top-level CLI dispatch. Returns `true` if a CLI command was handled.
pub fn handle_cli_command(subcommand: &SubcommandMatches) -> bool {
    match subcommand.name.as_str() {
        "add" => {
            workspace_handlers::handle_workspace_add(&subcommand.matches);
            true
        }
        "set" => {
            workspace_handlers::handle_workspace_set(&subcommand.matches);
            true
        }
        "st" => {
            workspace_handlers::handle_workspace_status(&subcommand.matches);
            true
        }
        "mv" => {
            workspace_handlers::handle_workspace_move(&subcommand.matches);
            true
        }
        "agent" => {
            workspace_handlers::handle_workspace_agent(&subcommand.matches);
            true
        }
        "commit" => {
            workspace_handlers::handle_workspace_commit(&subcommand.matches);
            true
        }
        "help" => {
            print_cli_help();
            true
        }
        _ => false,
    }
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
    println!(
        "  treq mv <source> <destination> -f [FILES...] -r [RANGES...] -c [COMMITS...]  (use '.' for the home repo)"
    );
    println!("  treq agent <branch> <prompt> [-m <edit|plan>]");
    println!("  treq commit <workspace_name> -m <message> [--push]");
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

mod workspace_handlers;

mod status_output;

#[cfg(test)]
mod tests;
