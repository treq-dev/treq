use crate::lock_ext::LockExt;
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer_opt, DebounceEventResult, Debouncer, FileIdMap};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::AppState;

pub struct WatcherManager {
  watchers: Arc<Mutex<HashMap<String, Debouncer<RecommendedWatcher, FileIdMap>>>>,
  app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl WatcherManager {
  pub fn new() -> Self {
    Self {
      watchers: Arc::new(Mutex::new(HashMap::new())),
      app_handle: Arc::new(Mutex::new(None)),
    }
  }

  pub fn set_app_handle(&self, handle: AppHandle) {
    let mut app_handle = self.app_handle.lock_or_recover();
    *app_handle = Some(handle);
  }

  pub fn cloned_app_handle(&self) -> Option<AppHandle> {
    self.app_handle.lock().ok()?.clone()
  }

  pub fn start_watching(&self, workspace_id: i64, workspace_path: String) -> Result<(), String> {
    let mut watchers = self.watchers.lock_or_recover();

    // Stop existing watcher for this workspace if any
    watchers.remove(&workspace_path);

    let path = PathBuf::from(&workspace_path);
    if !path.exists() {
      return Err(format!("Path does not exist: {}", workspace_path));
    }

    let app_handle = self.app_handle.clone();
    let ws_path = workspace_path.clone();
    let ws_id = workspace_id;

    // Create debounced watcher with 1s debounce
    let mut debouncer = new_debouncer_opt(
      Duration::from_millis(1000),
      None,
      move |result: DebounceEventResult| match result {
        Ok(events) => {
          let changed_paths: Vec<String> = events
            .iter()
            .flat_map(|e| e.paths.iter())
            .filter(|p| !is_ignored_path(p))
            .map(|p| p.to_string_lossy().to_string())
            .collect();

          if !changed_paths.is_empty() {
            if let Some(handle) = app_handle.lock_or_recover().as_ref() {
              let payload = serde_json::json!({
                  "workspace_id": ws_id,
                  "changed_paths": changed_paths
              });
              let _ = handle.emit("workspace-files-changed", payload);
            }
          }
        }
        Err(errors) => {
          log::error!("Watcher errors for {}: {:?}", ws_path, errors);
        }
      },
      FileIdMap::new(),
      notify::Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    debouncer
      .watch(&path, RecursiveMode::Recursive)
      .map_err(|e| format!("Failed to watch path: {}", e))?;

    watchers.insert(workspace_path, debouncer);
    Ok(())
  }

  pub fn stop_watching(&self, workspace_path: &str) -> Result<(), String> {
    let mut watchers = self.watchers.lock_or_recover();
    watchers.remove(workspace_path);
    Ok(())
  }
}

// TODO: Implement .gitignore support using the `ignore` crate
// For now, we use a simple hardcoded list of common ignore patterns
fn is_ignored_path(path: &Path) -> bool {
  let path_str = path.to_string_lossy();
  path_str.contains("/.jj/")
    || path_str.contains("/.git/")
    || path_str.contains("/node_modules/")
    || path_str.contains("/target/")
    || path_str.ends_with(".swp")
    || path_str.ends_with("~")
}

#[tauri::command]
pub fn start_file_watcher(
  state: State<AppState>,
  workspace_id: i64,
  workspace_path: String,
) -> Result<(), String> {
  state
    .watcher_manager
    .start_watching(workspace_id, workspace_path)
}

#[tauri::command]
pub fn stop_file_watcher(
  state: State<AppState>,
  _workspace_id: i64,
  workspace_path: String,
) -> Result<(), String> {
  state.watcher_manager.stop_watching(&workspace_path)
}
