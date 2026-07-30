use crate::AppState;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn pty_create_session(
    state: State<AppState>,
    app: AppHandle,
    session_id: String,
    working_dir: Option<String>,
    shell: Option<String>,
    initial_command: Option<String>,
    suppress_echo_for: Option<String>,
    remote_host: Option<String>,
) -> Result<(), String> {
    log::debug!(
        "pty_create_session: session_id={}, working_dir={:?}, shell={:?}, initial_command_present={}, suppress_echo_for_present={}",
        session_id,
        working_dir,
        shell,
        initial_command.is_some(),
        suppress_echo_for.is_some()
    );
    let pty_manager = state.pty_manager.lock().unwrap();
    let sid = session_id.clone();
    let event_name = format!("pty-data-{}", sid);

    let (shell, shell_args, working_dir, initial_command) = if let Some(host) = remote_host {
        let (program, args) = crate::core::remote::build_ssh_shell_command(
            &host,
            working_dir.as_deref(),
            initial_command.as_deref(),
        )?;
        (Some(program), args, None, None)
    } else {
        (shell, Vec::new(), working_dir, initial_command)
    };

    let result = pty_manager.create_session(
        session_id,
        working_dir,
        shell,
        shell_args,
        initial_command,
        suppress_echo_for,
        Box::new(move |data| {
            if let Err(error) = app.emit(&event_name, data) {
                log::warn!(
                    "pty emit failed: session_id={}, event={}, error={}",
                    sid,
                    event_name,
                    error
                );
            }
        }),
    );
    result
}

#[tauri::command]
pub fn pty_session_exists(state: State<AppState>, session_id: String) -> Result<bool, String> {
    let pty_manager = state.pty_manager.lock().unwrap();
    Ok(pty_manager.session_exists(&session_id))
}

#[tauri::command]
pub fn pty_write(state: State<AppState>, session_id: String, data: String) -> Result<(), String> {
    log::debug!(
        "pty_write: session_id={}, data_len={}",
        session_id,
        data.len()
    );
    let pty_manager = state.pty_manager.lock().unwrap();
    pty_manager.write_to_session(&session_id, &data)
}

#[tauri::command]
pub fn pty_resize(
    state: State<AppState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    log::debug!(
        "pty_resize: session_id={}, rows={}, cols={}",
        session_id,
        rows,
        cols
    );
    let pty_manager = state.pty_manager.lock().unwrap();
    pty_manager.resize_session(&session_id, rows, cols)
}

#[tauri::command]
pub fn pty_write_suppress_echo(
    state: State<AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    log::debug!(
        "pty_write_suppress_echo: session_id={}, data_len={}",
        session_id,
        data.len()
    );
    let pty_manager = state.pty_manager.lock().unwrap();
    pty_manager.set_auto_command(&session_id, &data)?;
    pty_manager.write_to_session(&session_id, &data)
}

#[tauri::command]
pub fn pty_close(state: State<AppState>, session_id: String) -> Result<(), String> {
    log::debug!("pty_close: session_id={}", session_id);
    let pty_manager = state.pty_manager.lock().unwrap();
    pty_manager.close_session(&session_id)
}
