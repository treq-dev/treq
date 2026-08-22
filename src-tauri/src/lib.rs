mod agent_dispatch;
mod agent_runtime;
pub mod auto_rebase;
pub mod binary_paths;
mod cli;
mod commands;
mod commit_timestamps;
pub mod conflict_markers;
pub mod core;
pub mod db;
pub mod file_indexer;
pub mod github;
pub mod jj;
pub mod local_db;
mod open_new_window;
pub mod pr_status;
pub mod pty;
pub mod send_dispatch;
pub mod telemetry;

use agent_runtime::{
  parse_agent_request_from_url, route_agent_deep_link, route_agent_dispatch_request,
  start_agent_ipc_listener, start_instance_registry_heartbeat,
};
use commands::file_watcher::WatcherManager;
use db::Database;
use pty::PtyManager;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, EventTarget, Manager};
use tauri_plugin_log::{Target, TargetKind};

#[cfg(feature = "tauri-test")]
extern crate self as treq_lib;

#[cfg(feature = "tauri-test")]
mod e2e_test_helpers;

#[cfg(feature = "tauri-test")]
mod tauri_test_bridge;

#[cfg(feature = "tauri-test")]
#[tauri_test::setup(init = tauri_test_bridge::init_test_state)]
pub struct TauriTestApp;

pub(crate) struct AppState {
  db: Mutex<Database>,
  pty_manager: Mutex<PtyManager>,
  watcher_manager: WatcherManager,
  window_repo_paths: Mutex<HashMap<String, String>>,
  window_last_focused_at: Mutex<HashMap<String, u64>>,
  dispatch_instance_id: String,
  dispatch_started_at: u64,
  dispatch_endpoint: String,
  // Held for its Drop guards (file writer + provider shutdown).
  _telemetry: telemetry::TelemetryGuards,
}

impl AppState {
  pub(crate) fn new(
    db: Database,
    pty_manager: PtyManager,
    watcher_manager: WatcherManager,
    dispatch_instance_id: String,
    dispatch_started_at: u64,
    dispatch_endpoint: String,
    telemetry: telemetry::TelemetryGuards,
  ) -> Self {
    Self {
      db: Mutex::new(db),
      pty_manager: Mutex::new(pty_manager),
      watcher_manager,
      window_repo_paths: Mutex::new(HashMap::new()),
      window_last_focused_at: Mutex::new(HashMap::new()),
      dispatch_instance_id,
      dispatch_started_at,
      dispatch_endpoint,
      _telemetry: telemetry,
    }
  }
}

/// Emits an event only to the focused webview window.
///
/// On macOS the menu bar unfocuses every window, so this never broadcasts
/// globally — a broadcast would run folder pickers in every open webview.
pub fn emit_to_focused<S: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
  let windows = app.webview_windows();
  let focused: Vec<String> = windows
    .iter()
    .filter_map(|(label, window)| {
      if window.is_focused().unwrap_or(false) {
        Some(label.clone())
      } else {
        None
      }
    })
    .collect();
  let existing: Vec<String> = windows.keys().cloned().collect();
  let last_focused = app
    .try_state::<AppState>()
    .and_then(|state| state.window_last_focused_at.lock().ok().map(|g| g.clone()))
    .unwrap_or_default();
  let Some(label) =
    open_new_window::resolve_menu_event_window_label(&focused, &last_focused, &existing)
  else {
    return;
  };
  let _ = app.emit_to(EventTarget::webview_window(&label), event, payload);
}

fn schedule_open_repo_in_new_window(app: AppHandle) {
  if !open_new_window::OPEN_NEW_WINDOW_GATE.try_begin() {
    return;
  }
  // Leave the AppKit menu-tracking run loop before showing NSOpenPanel.
  // Showing the panel nested in the menu action redelivers the same item
  // when the new window becomes key, which retriggers the folder picker.
  std::thread::spawn(move || {
    let app_for_main = app.clone();
    if app
      .run_on_main_thread(move || {
        pick_folder_and_open_new_window(app_for_main);
      })
      .is_err()
    {
      open_new_window::OPEN_NEW_WINDOW_GATE.end();
    }
  });
}

fn pick_folder_and_open_new_window(app: AppHandle) {
  use tauri_plugin_dialog::DialogExt;

  app
    .dialog()
    .file()
    .set_title("Select Folder")
    .pick_folder(move |folder| {
      let Some(file_path) = folder else {
        open_new_window::OPEN_NEW_WINDOW_GATE.end();
        return;
      };
      let path = match file_path.into_path() {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(_) => {
          open_new_window::OPEN_NEW_WINDOW_GATE.end();
          return;
        }
      };
      let app_for_init = app.clone();
      tauri::async_runtime::spawn(async move {
        let path_for_init = path.clone();
        let init_ok = tauri::async_runtime::spawn_blocking(move || core::init(&path_for_init))
          .await
          .ok()
          .and_then(Result::ok)
          .unwrap_or(false);
        if !init_ok {
          emit_to_focused(&app_for_init, "menu-open-in-new-window-invalid", ());
          open_new_window::OPEN_NEW_WINDOW_GATE.end();
          return;
        }
        let label = open_new_window::new_repo_window_label();
        let url = open_new_window::new_repo_window_url(&path);
        let title = open_new_window::new_repo_window_title(&path);
        let _ = tauri::WebviewWindowBuilder::new(
          &app_for_init,
          &label,
          tauri::WebviewUrl::App(url.into()),
        )
        .title(&title)
        .inner_size(1400.0, 900.0)
        .build();
        open_new_window::OPEN_NEW_WINDOW_GATE.end();
      });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  telemetry::install_panic_hook();
  tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .target(Target::new(TargetKind::Dispatch(
                    tauri_plugin_log::fern::Dispatch::new().chain(
                        tauri_plugin_log::fern::Output::call(telemetry::forward_log_record),
                    ),
                )))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_cli::init())
        .setup(|app| {
            // --- Initialize telemetry first, before anything (CLI or GUI) that may log ---
            let log_dir = app.path().app_log_dir().expect("Failed to get app log dir");
            let telemetry = telemetry::init(&log_dir).expect("Failed to initialize telemetry");

            // --- CLI mode: handle commands and exit before any GUI init ---
            {
                use tauri_plugin_cli::CliExt;
                match app.cli().matches() {
                    Ok(matches) => {
                        cli::init_cli_binary_paths();
                        if let Some(ref subcommand) = matches.subcommand {
                            if let Some(exit_code) = cli::handle_cli_command(subcommand) {
                                // Drop explicitly to flush the log writer before the process exits,
                                // since `app.handle().exit()` does not run Rust destructors.
                                drop(telemetry);
                                app.handle().exit(exit_code);
                                return Ok(());
                            }
                            let msg = format!("Unknown command: {}", subcommand.name);
                            eprintln!("{}", msg);
                            tracing::error!("{}", msg);
                            eprintln!("Usage:");
                            eprintln!("  treq add <branch_name> [-d description] [-l title] [-s source_branch] [-p sparse]... [-k symlink]...");
                            eprintln!("  treq set <workspace_name> [-d description] [-l title] [-t target_branch]");
                            eprintln!("  treq st [workspace_name]");
                            eprintln!("  treq diff [workspace_name]");
                            eprintln!("  treq agent <branch> <prompt> [-m <edit|plan>]");
                            eprintln!("  treq help");
                            drop(telemetry);
                            app.handle().exit(1);
                            return Ok(());
                        } else if cli::handle_cli_global_args(&matches) {
                            drop(telemetry);
                            app.handle().exit(0);
                            return Ok(());
                        } else if !matches.args.is_empty() {
                            // Defensive: a recognized-but-unhandled top-level arg was passed.
                            // Treat it as a CLI error rather than silently opening the GUI.
                            let msg = format!("Unrecognized arguments: {:?}", matches.args);
                            eprintln!("{}", msg);
                            tracing::error!("{}", msg);
                            drop(telemetry);
                            app.handle().exit(1);
                            return Ok(());
                        }
                        // No args at all: fall through to normal GUI launch.
                    }
                    Err(e) => {
                        // Malformed CLI invocation (unrecognized subcommand/flag, missing
                        // required argument, wrong value count, etc). clap's error message
                        // already includes usage help, so surface it and exit non-zero
                        // instead of silently falling through to the GUI.
                        let msg = e.to_string();
                        eprintln!("{}", msg);
                        tracing::error!("{}", msg);
                        drop(telemetry);
                        app.handle().exit(1);
                        return Ok(());
                    }
                }
            }

            // --- GUI mode: continue setup ---

            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("Failed to create app data directory");
            std::env::set_var("TREQ_APP_DATA_DIR", app_dir.to_string_lossy().to_string());
            let db_path = app_dir.join("treq.db");
            std::env::set_var("TREQ_APP_DB_PATH", db_path.to_string_lossy().to_string());

            let db = Database::new(db_path).expect("Failed to open database");
            db.init().expect("Failed to initialize database");

            // Read saved repo path to embed in the window URL (avoids Onboarding flash)
            let saved_repo_path = db.get_setting("last_opened_repo_path").ok().flatten();
            let window_url = if let Some(ref path) = saved_repo_path {
                let encoded = urlencoding::encode(path).into_owned();
                format!("index.html?repo={}", encoded)
            } else {
                "index.html".to_string()
            };

            let _window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App(window_url.into()),
            )
            .title("Treq - Stacking ADE")
            .inner_size(1400.0, 900.0)
            .build()?;

            // Load cached binary paths and initialize in-memory cache
            let binary_paths = commands::load_cached_binary_paths(&db);
            binary_paths::init_binary_paths_cache(binary_paths);

            // Load cached editor apps and initialize in-memory cache
            let editor_apps = commands::load_cached_editor_apps(&db);
            binary_paths::init_editor_apps_cache(editor_apps);

            let pty_manager = PtyManager::new();

            // Initialize file watcher
            let watcher_manager = WatcherManager::new();
            watcher_manager.set_app_handle(app.handle().clone());

            // Background PR-status poller (sidebar reads from its cache)
            crate::pr_status::set_app_handle(app.handle().clone());

            let (dispatch_listener, dispatch_endpoint) = agent_dispatch::bind_ephemeral_listener()?;
            let dispatch_instance_id = uuid::Uuid::new_v4().to_string();
            let dispatch_started_at = agent_dispatch::now_millis();
            let app_state = AppState::new(
                db,
                pty_manager,
                watcher_manager,
                dispatch_instance_id,
                dispatch_started_at,
                dispatch_endpoint,
                telemetry,
            );

            app.manage(app_state);
            start_agent_ipc_listener(app.handle().clone(), dispatch_listener);
            start_instance_registry_heartbeat(app.handle().clone());

            // Listen for deep-link events and forward to frontend
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> =
                        event.urls().into_iter().map(|u| u.to_string()).collect();
                    for url in urls {
                        if let Some(request) = parse_agent_request_from_url(&url) {
                            let response = route_agent_dispatch_request(&handle, &request);
                            if response.status != "handled" {
                                log::info!(
                                    "agent deep link unmatched repo={} request_id={}",
                                    request.repo,
                                    request.request_id
                                );
                            }
                        } else if !route_agent_deep_link(&handle, url) {
                            log::info!("agent deep link ignored (no matching window/repo)");
                        }
                    }
                });
            }

            // Create menu
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::PredefinedMenuItem;

                // App menu (automatically gets app name on macOS)
                let app_menu = SubmenuBuilder::new(app, "App")
                    .item(&PredefinedMenuItem::hide(app, None)?)
                    .item(&PredefinedMenuItem::hide_others(app, None)?)
                    .item(&PredefinedMenuItem::show_all(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::quit(app, None)?)
                    .build()?;

                // File menu items
                let open_item = MenuItemBuilder::with_id("open", "Open...")
                    .accelerator("CmdOrCtrl+O")
                    .build(app)?;

                let open_new_window_item =
                    MenuItemBuilder::with_id("open_new_window", "Open in New Window...")
                        .accelerator("CmdOrCtrl+Shift+O")
                        .build(app)?;

                let file_menu = SubmenuBuilder::new(app, "File")
                    .item(&open_item)
                    .item(&open_new_window_item)
                    .build()?;

                // Edit menu with native shortcuts
                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .item(&PredefinedMenuItem::undo(app, None)?)
                    .item(&PredefinedMenuItem::redo(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::cut(app, None)?)
                    .item(&PredefinedMenuItem::copy(app, None)?)
                    .item(&PredefinedMenuItem::paste(app, None)?)
                    .item(&PredefinedMenuItem::select_all(app, None)?)
                    .build()?;

                // View menu
                let view_menu = SubmenuBuilder::new(app, "View")
                    .item(&PredefinedMenuItem::fullscreen(app, None)?)
                    .build()?;

                // Go menu items
                let dashboard_item = MenuItemBuilder::with_id("dashboard", "Dashboard")
                    .accelerator("CmdOrCtrl+D")
                    .build(app)?;

                let settings_item = MenuItemBuilder::with_id("settings", "Settings")
                    .accelerator("CmdOrCtrl+,")
                    .build(app)?;

                let go_menu = SubmenuBuilder::new(app, "Go")
                    .item(&dashboard_item)
                    .item(&settings_item)
                    .build()?;

                // Developer menu (only in debug mode)
                #[cfg(debug_assertions)]
                let developer_menu = {
                    let open_web_inspector =
                        MenuItemBuilder::with_id("open_web_inspector", "Open Web Inspector")
                            .accelerator("CmdOrCtrl+Shift+I")
                            .build(app)?;

                    let force_rebase_item = MenuItemBuilder::with_id(
                        "force_rebase_workspace",
                        "Force Rebase Workspace",
                    )
                    .accelerator("CmdOrCtrl+Shift+R")
                    .build(app)?;

                    let factory_reset_item =
                        MenuItemBuilder::with_id("factory_reset", "Factory Reset").build(app)?;

                    SubmenuBuilder::new(app, "Developer")
                        .item(&open_web_inspector)
                        .separator()
                        .item(&force_rebase_item)
                        .separator()
                        .item(&factory_reset_item)
                        .build()?
                };

                // Window menu
                //
                // Close Window intentionally has no keyboard accelerator: the OS-default
                // Cmd+W is repurposed in the frontend to close the selected terminal (or
                // do nothing) instead of closing the whole treq window. The menu item is
                // still clickable and closes the focused window via the handler below.
                let close_window_item =
                    MenuItemBuilder::with_id("close_window", "Close Window").build(app)?;

                let window_menu = SubmenuBuilder::new(app, "Window")
                    .item(&PredefinedMenuItem::minimize(app, None)?)
                    .item(&PredefinedMenuItem::maximize(app, None)?)
                    .separator()
                    .item(&close_window_item)
                    .build()?;

                // Help menu
                let view_logs_item =
                    MenuItemBuilder::with_id("view_logs", "View Logs").build(app)?;

                let check_for_updates_item =
                    MenuItemBuilder::with_id("check_for_updates", "Check for Updates...").build(app)?;

                let learn_more_item =
                    MenuItemBuilder::with_id("learn_more", "Learn More").build(app)?;

                let help_menu = SubmenuBuilder::new(app, "Help")
                    .item(&check_for_updates_item)
                    .item(&view_logs_item)
                    .separator()
                    .item(&learn_more_item)
                    .build()?;

                let menu_builder = MenuBuilder::new(app)
                    .item(&app_menu)
                    .item(&file_menu)
                    .item(&edit_menu)
                    .item(&view_menu)
                    .item(&go_menu);

                // Add Developer menu in debug mode
                #[cfg(debug_assertions)]
                let menu_builder = menu_builder.item(&developer_menu);

                let menu = menu_builder.item(&window_menu).item(&help_menu).build()?;

                app.set_menu(menu)?;
            }

            #[cfg(not(target_os = "macos"))]
            {
                // File menu items
                let open_item = MenuItemBuilder::with_id("open", "Open...")
                    .accelerator("CmdOrCtrl+O")
                    .build(app)?;

                let open_new_window_item =
                    MenuItemBuilder::with_id("open_new_window", "Open in New Window...")
                        .accelerator("CmdOrCtrl+Shift+O")
                        .build(app)?;

                let file_menu = SubmenuBuilder::new(app, "File")
                    .item(&open_item)
                    .item(&open_new_window_item)
                    .build()?;

                // Go menu items
                let dashboard_item = MenuItemBuilder::with_id("dashboard", "Dashboard")
                    .accelerator("CmdOrCtrl+D")
                    .build(app)?;

                let settings_item = MenuItemBuilder::with_id("settings", "Settings")
                    .accelerator("CmdOrCtrl+,")
                    .build(app)?;

                let go_menu = SubmenuBuilder::new(app, "Go")
                    .item(&dashboard_item)
                    .item(&settings_item)
                    .build()?;

                // Developer menu (only in debug mode)
                #[cfg(debug_assertions)]
                let developer_menu = {
                    let open_web_inspector =
                        MenuItemBuilder::with_id("open_web_inspector", "Open Web Inspector")
                            .accelerator("CmdOrCtrl+Shift+I")
                            .build(app)?;

                    let force_rebase_item = MenuItemBuilder::with_id(
                        "force_rebase_workspace",
                        "Force Rebase Workspace",
                    )
                    .accelerator("CmdOrCtrl+Shift+R")
                    .build(app)?;

                    let factory_reset_item =
                        MenuItemBuilder::with_id("factory_reset", "Factory Reset").build(app)?;

                    SubmenuBuilder::new(app, "Developer")
                        .item(&open_web_inspector)
                        .separator()
                        .item(&force_rebase_item)
                        .separator()
                        .item(&factory_reset_item)
                        .build()?
                };

                // Help menu
                let view_logs_item =
                    MenuItemBuilder::with_id("view_logs", "View Logs").build(app)?;
                let learn_more_item =
                    MenuItemBuilder::with_id("learn_more", "Learn More").build(app)?;
                let help_menu = SubmenuBuilder::new(app, "Help")
                    .item(&view_logs_item)
                    .separator()
                    .item(&learn_more_item)
                    .build()?;

                let mut menu_builder = MenuBuilder::new(app).item(&file_menu).item(&go_menu);

                // Add Developer menu in debug mode
                #[cfg(debug_assertions)]
                {
                    menu_builder = menu_builder.item(&developer_menu);
                }

                let menu = menu_builder.item(&help_menu).build()?;

                app.set_menu(menu)?;
            }

            // Handle menu events - emit only to focused window
            app.on_menu_event(move |app, event| match event.id().as_ref() {
                "dashboard" => emit_to_focused(app, "navigate-to-dashboard", ()),
                "settings" => emit_to_focused(app, "navigate-to-settings", ()),
                "open" => emit_to_focused(app, "menu-open-repository", ()),
                "open_new_window" => schedule_open_repo_in_new_window(app.clone()),
                "open_web_inspector" =>
                {
                    #[cfg(debug_assertions)]
                    if let Some(w) = app.get_webview_window("main") {
                        w.open_devtools();
                    }
                }
                "close_window" => {
                    for (_, window) in app.webview_windows() {
                        if window.is_focused().unwrap_or(false) {
                            let _ = window.close();
                            break;
                        }
                    }
                }
                "force_rebase_workspace" => emit_to_focused(app, "menu-force-rebase-workspace", ()),
                "factory_reset" => emit_to_focused(app, "menu-factory-reset", ()),
                "view_logs" => {
                    use tauri_plugin_opener::OpenerExt;
                    if let Ok(dir) = app.path().app_log_dir() {
                        let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
                    }
                }
                "check_for_updates" => emit_to_focused(app, "menu-check-for-updates", ()),
                "learn_more" => {
                    #[cfg(target_os = "macos")]
                    {
                        use tauri_plugin_opener::OpenerExt;
                        let _ = app.opener().open_url("https://treq.dev", None::<&str>);
                    }
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::acknowledge_agent_dispatch,
            commands::detect_editor_apps,
            commands::get_treq_bin_dir,
            commands::get_workspaces,
            commands::create_workspace,
            commands::open_or_create_workspace_from_pr,
            commands::delete_workspace,
            commands::get_repo_default_branch,
            commands::push_workspace_to_remote,
            commands::pull_workspace_from_remote,
            commands::merge_workspace,
            commands::move_workspace_changes,
            commands::move_commit_to_existing_workspace,
            commands::abandon_commit,
            commands::rename_workspace,
            commands::list_workspace_statuses,
            commands::get_workspace_status,
            commands::update_workspace,
            commands::schedule_workspaces,
            commands::set_workspace_target_branch,
            commands::check_and_rebase_workspaces,
            commands::resolve_workspace_bookmark_conflict,
            commands::ensure_workspace_indexed,
            commands::get_setting,
            commands::get_settings_batch,
            commands::set_setting,
            commands::get_repo_setting,
            commands::set_repo_setting,
            commands::check_for_app_update,
            commands::install_app_update,
            commands::get_workspace_file_hunks,
            commands::get_workspace_file_lines,
            commands::jj_restore_file,
            commands::jj_restore_all,
            commands::jj_snapshot_working_copy,
            commands::jj_restore_snapshot,
            commands::undo_repo_operation,
            commands::create_commit,
            commands::list_commits,
            commands::jj_split,
            commands::get_repo_current_branch,
            commands::get_workspace_changed_files,
            commands::set_git_submodule_synced,
            commands::init_repo,
            commands::jj_git_fetch_background,
            commands::jj_get_commits_ahead,
            commands::get_workspace_diff,
            commands::get_commit_diff,
            commands::get_commit_file_diff,
            commands::jj_check_branch_exists,
            commands::list_repo_branches,
            commands::switch_repo_branch,
            commands::get_commit_description,
            commands::describe_commit,
            commands::shift_commit_timestamp,
            commands::shift_mutable_commits_to_now,
            commands::start_resolve_conflicts,
            commands::build_resolve_agent_prompt,
            commands::resolve_commit,
            commands::pty_create_session,
            commands::pty_session_exists,
            commands::pty_write,
            commands::pty_write_suppress_echo,
            commands::pty_resize,
            commands::pty_close,
            commands::read_file,
            commands::write_send_review_image,
            commands::write_agent_cli_files,
            commands::cleanup_agent_cli_files,
            commands::get_file_modified_at,
            commands::list_directory,
            commands::list_send_artifacts,
            commands::ls_workspace,
            commands::list_gitignored_path_suggestions,
            commands::get_workspace_readme,
            commands::list_directory_cached,
            commands::search_workspace_files,
            commands::create_session,
            commands::get_sessions,
            commands::update_session_access,
            commands::get_session_model,
            commands::set_session_model,
            commands::add_prompt_history,
            commands::get_prompt_history,
            commands::get_workspace_starting_prompt,
            commands::stash_workspace_changes,
            commands::stash_commit,
            commands::list_stashes,
            commands::delete_stash,
            commands::apply_stash,
            commands::get_stash_diff,
            commands::export_stash_git_patch,
            commands::mark_file_viewed,
            commands::unmark_file_viewed,
            commands::start_file_watcher,
            commands::stop_file_watcher,
            commands::load_pending_review,
            commands::save_pending_review,
            commands::clear_pending_review,
            commands::load_file_browser_review,
            commands::save_file_browser_review,
            commands::clear_file_browser_review,
            commands::load_pending_page_review,
            commands::save_pending_page_review,
            commands::clear_pending_page_review,
            commands::open_browser_webview,
            commands::navigate_browser_webview,
            commands::close_browser_webview,
            commands::set_browser_select_mode,
            commands::sync_browser_webview_bounds,
            commands::set_window_repo_path,
            commands::get_window_repo_path,
            commands::rebase_home_repo_branch,
            commands::dry_run_home_repo_rebase,
            commands::get_git_remote_url,
            commands::get_pr_info_via_gh,
            commands::start_pr_status_polling,
            commands::stop_pr_status_polling,
            commands::list_cached_pr_statuses,
            commands::get_cached_pr_info,
            commands::list_cached_pr_ci_statuses,
            commands::get_cached_pr_ci_status,
            commands::refresh_pr_statuses,
            commands::refresh_pr_branch_status,
            commands::get_pr_checks_via_gh,
            commands::get_pr_checks_for_pr,
            commands::gh_list_issues,
            commands::gh_view_issue,
            commands::gh_create_issue,
            commands::gh_create_issue_comment,
            commands::gh_close_issue,
            commands::gh_reopen_issue,
            commands::gh_list_prs,
            commands::gh_view_pr,
            commands::gh_create_pr_comment,
            commands::gh_close_pr,
            commands::gh_reopen_pr,
            commands::gh_set_pr_draft,
            commands::gh_create_pr,
            commands::gh_list_pr_review_threads,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::agent_runtime::{
    build_agent_deep_link_url, extract_repo_from_agent_deep_link, parse_agent_request_from_url,
  };

  #[test]
  fn extracts_repo_from_agent_deep_link() {
    let url =
            "treq://agent/start?repo=%2Ftmp%2Frepo&branch=feat%2Fx&prompt=hello&mode=plan&agent=codex&request_id=req-1";
    let repo = extract_repo_from_agent_deep_link(url);
    assert_eq!(repo.as_deref(), Some("/tmp/repo"));
  }

  #[test]
  fn ignores_non_agent_deep_link() {
    let url = "treq://auth/callback?token=abc";
    assert_eq!(extract_repo_from_agent_deep_link(url), None);
  }

  #[test]
  fn parse_agent_request_from_url_round_trips() {
    let request = crate::agent_dispatch::AgentDispatchRequest {
      request_id: "req-1".to_string(),
      repo: "/tmp/repo".to_string(),
      branch: "feat/x".to_string(),
      prompt: "hello".to_string(),
      mode: "plan".to_string(),
      agent: "codex".to_string(),
    };
    let url = build_agent_deep_link_url(&request);
    let parsed = parse_agent_request_from_url(&url).expect("request should parse");
    assert_eq!(parsed, request);
  }
}
