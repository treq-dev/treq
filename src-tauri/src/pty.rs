use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use regex::Regex;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

/// Process a chunk of bytes, handling incomplete UTF-8 sequences at boundaries.
///
/// - `pending`: mutable buffer containing incomplete bytes from the previous chunk
/// - `new_bytes`: the new bytes read from the PTY
///
/// Returns a valid UTF-8 String, potentially leaving trailing incomplete bytes in `pending`.
fn process_utf8_chunk(pending: &mut Vec<u8>, new_bytes: &[u8]) -> String {
    // Combine pending bytes with new bytes
    let mut combined = std::mem::take(pending);
    combined.extend_from_slice(new_bytes);

    match std::str::from_utf8(&combined) {
        Ok(valid_str) => {
            // All bytes are valid UTF-8
            valid_str.to_string()
        }
        Err(error) => {
            let valid_up_to = error.valid_up_to();

            // Check if this is an incomplete sequence at the end (not a real error)
            if error.error_len().is_none() {
                // Incomplete sequence at end - buffer the trailing bytes
                let (valid, trailing) = combined.split_at(valid_up_to);
                *pending = trailing.to_vec();

                // Return the valid portion (should always be valid UTF-8)
                String::from_utf8(valid.to_vec()).unwrap_or_default()
            } else {
                // Invalid UTF-8 mid-stream: use lossy output (rare for a real PTY)
                String::from_utf8_lossy(&combined).to_string()
            }
        }
    }
}

/// Strip ANSI escape sequences from a string.
pub fn strip_ansi_codes(s: &str) -> String {
    // Match CSI sequences (including private modes like ?1h), OSC sequences, and charset designations
    let re = Regex::new(
        r"\x1b\[[\x20-\x3f]*[\x30-\x3f]*[\x40-\x7e]|\x1b\][^\x07]*\x07|\x1b\([A-Z]|\x1b[=>]",
    )
    .unwrap();
    re.replace_all(s, "").to_string()
}

/// Check if a line's content overlaps with the auto_command text.
/// Uses 20-char sliding window substring matching (char-based, not byte-based).
pub fn line_matches_auto_command(stripped_line: &str, auto_command: &str) -> bool {
    let trimmed = stripped_line.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() < 20 {
        return false;
    }
    for i in 0..=(chars.len() - 20) {
        let window: String = chars[i..i + 20].iter().collect();
        if auto_command.contains(&window) {
            return true;
        }
    }
    false
}

pub struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send>,
    auto_command: Arc<Mutex<Option<String>>>,
}

impl PtySession {
    pub fn write(&mut self, data: &[u8]) -> std::io::Result<()> {
        self.writer.write_all(data)?;
        self.writer.flush()
    }

    pub fn resize(&mut self, rows: u16, cols: u16) -> std::io::Result<()> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
    }

    fn shutdown(&mut self) -> Result<(), String> {
        if let Err(err) = self.child.kill() {
            let err_text = err.to_string().to_lowercase();
            if !err_text.contains("no such process") && !err_text.contains("not found") {
                return Err(format!("Failed to kill PTY child: {err}"));
            }
        }

        if let Err(err) = self.child.wait() {
            let err_text = err.to_string().to_lowercase();
            if !err_text.contains("no child processes")
                && !err_text.contains("already")
                && !err_text.contains("not found")
            {
                return Err(format!("Failed to wait PTY child: {err}"));
            }
        }

        Ok(())
    }

    fn process_id(&self) -> Option<u32> {
        self.child.process_id()
    }
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        PtyManager {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_session(
        &self,
        session_id: String,
        working_dir: Option<String>,
        shell: Option<String>,
        shell_args: Vec<String>,
        initial_command: Option<String>,
        suppress_echo_for: Option<String>,
        callback: Box<dyn Fn(String) + Send + 'static>,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let shell_cmd = shell.unwrap_or_else(|| {
            std::env::var("SHELL").unwrap_or_else(|_| {
                if cfg!(windows) {
                    "powershell.exe".to_string()
                } else {
                    "/bin/bash".to_string()
                }
            })
        });

        let mut cmd = CommandBuilder::new(&shell_cmd);
        for arg in shell_args {
            cmd.arg(arg);
        }
        if let Some(dir) = working_dir {
            cmd.cwd(dir);
        }
        cmd.env("TERM", "xterm-256color");

        // Set extended PATH so terminal can find jj, git, claude binaries
        cmd.env("PATH", crate::binary_paths::get_extended_path());

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let master = pair.master;

        let auto_command: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(suppress_echo_for));
        let auto_command_reader = auto_command.clone();

        // Store session with master for resizing
        {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.insert(
                session_id.clone(),
                PtySession {
                    writer,
                    master,
                    child,
                    auto_command,
                },
            );
        }

        // Execute initial command if provided
        if let Some(cmd) = initial_command {
            // Wait a bit for shell to be ready
            thread::sleep(std::time::Duration::from_millis(100));
            let cmd_with_newline = format!("{}\n", cmd);
            self.write_to_session(&session_id, &cmd_with_newline)?;
        }

        // Spawn reader thread
        thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            let mut pending_bytes: Vec<u8> = Vec::with_capacity(4);
            let mut line_buffer = String::new();
            let mut non_matching_lines_emitted: usize = 0;
            let mut seen_command_echo = false;
            // Once we've emitted enough non-matching lines, stop filtering
            const FILTER_STOP_THRESHOLD: usize = 5;

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        // EOF: flush any pending bytes
                        if !pending_bytes.is_empty() {
                            let data = String::from_utf8_lossy(&pending_bytes).to_string();
                            if !data.is_empty() {
                                line_buffer.push_str(&data);
                            }
                        }
                        // Flush remaining line buffer
                        if !line_buffer.is_empty() {
                            callback(line_buffer);
                        }
                        break;
                    }
                    Ok(n) => {
                        let data = process_utf8_chunk(&mut pending_bytes, &buffer[..n]);
                        if data.is_empty() {
                            continue;
                        }

                        // Check if filtering is active
                        let filter_cmd = {
                            let guard = auto_command_reader.lock().unwrap();
                            guard.clone()
                        };

                        if filter_cmd.is_none() {
                            // No filter active, pass through directly
                            callback(data);
                            continue;
                        }

                        let filter_cmd = filter_cmd.unwrap();

                        // Filtering is active: buffer and process line by line
                        line_buffer.push_str(&data);

                        while let Some(newline_pos) = line_buffer.find('\n') {
                            let line = line_buffer[..=newline_pos].to_string();
                            line_buffer = line_buffer[newline_pos + 1..].to_string();

                            let stripped = strip_ansi_codes(&line);

                            // Discard lines matching the auto_command
                            if line_matches_auto_command(&stripped, &filter_cmd) {
                                seen_command_echo = true;
                                continue;
                            }

                            // Phase 1: before command echo, suppress all output (prompt, blanks, etc.)
                            if !seen_command_echo {
                                continue;
                            }

                            // Phase 2: After command echo, discard empty/whitespace lines
                            if stripped.trim().is_empty() {
                                continue;
                            }

                            // Phase 3: Emit non-matching, non-empty lines
                            callback(line);
                            non_matching_lines_emitted += 1;

                            if non_matching_lines_emitted >= FILTER_STOP_THRESHOLD {
                                {
                                    // Stop filtering by clearing the auto_command
                                    let mut guard = auto_command_reader.lock().unwrap();
                                    *guard = None;
                                }
                                if !line_buffer.is_empty() {
                                    let remaining = std::mem::take(&mut line_buffer);
                                    callback(remaining);
                                }
                                break;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(())
    }

    pub fn write_to_session(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(session_id) {
            session.write(data.as_bytes()).map_err(|e| e.to_string())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn resize_session(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(session_id) {
            session.resize(rows, cols).map_err(|e| e.to_string())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn close_session(&self, session_id: &str) -> Result<(), String> {
        let mut session = {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.remove(session_id)
        };

        if let Some(ref mut session) = session {
            session.shutdown()?;
        }

        Ok(())
    }

    pub fn set_auto_command(&self, session_id: &str, command: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get(session_id) {
            let mut guard = session.auto_command.lock().unwrap();
            *guard = Some(command.to_string());
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn session_exists(&self, session_id: &str) -> bool {
        let sessions = self.sessions.lock().unwrap();
        sessions.contains_key(session_id)
    }

    #[doc(hidden)]
    pub fn session_process_id(&self, session_id: &str) -> Option<u32> {
        let sessions = self.sessions.lock().unwrap();
        sessions
            .get(session_id)
            .and_then(|session| session.process_id())
    }
}
