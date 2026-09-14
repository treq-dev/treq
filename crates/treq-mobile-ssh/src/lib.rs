//! Mobile SSH bridge crate for the `mobile/` React Native app.
//!
//! Mirrors `src-tauri/src/core/remote_ssh_transport.rs`'s use of `russh` for
//! the desktop app (same `russh` version, same client-handler shape), but
//! exposed through a UniFFI interface so it can be compiled as a
//! static/shared library and called from Swift (iOS) and Kotlin (Android)
//! native modules, per the pattern described in
//! https://rust-dd.com/post/building-a-rust-native-module-for-react-native-on-ios-and-android.
//!
//! Scope (first milestone, see `prds/mobile.md` Phase 2): device key
//! generation and a manual host/port/key connect + exec flow. Certificate
//! issuance and the Supabase control plane are not wired here yet.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use russh::client::{self, AuthResult, Handle};
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};

uniffi::include_scaffolding!("treq_mobile_ssh");

#[cfg(feature = "napi")]
mod napi_bridge;

#[derive(Debug, thiserror::Error)]
pub enum SshError {
    #[error("host key did not match the expected fingerprint")]
    HostKeyMismatch,
    #[error("connection failed: {0}")]
    ConnectionFailed(String),
    #[error("authentication failed: {0}")]
    AuthenticationFailed(String),
    #[error("key material unavailable: {0}")]
    KeyMaterialUnavailable(String),
    #[error("command failed: {0}")]
    CommandFailed(String),
    #[error("session not found")]
    SessionNotFound,
}

pub struct DeviceKeyInfo {
    pub public_key_openssh: String,
    pub fingerprint_sha256: String,
    pub private_key_pem: String,
}

pub struct ExecResult {
    pub exit_status: i32,
    pub stdout: String,
    pub stderr: String,
}

/// PTY output/lifecycle event (mobile PRD Phase 7, item 2). See
/// `poll_pty_events` for why this is drained by polling rather than pushed
/// through a UniFFI async callback interface.
pub enum PtyEvent {
    Data { bytes: Vec<u8> },
    ExitStatus { code: u32 },
    Closed,
}

/// Bound on how many undrained events a single PTY session buffers before
/// the oldest are dropped, mirroring desktop's
/// `remote_pty::MAX_BUFFERED_OUTPUT_BYTES` backstop — a client that stops
/// polling (backgrounded app) must not let the VM-side process consume
/// unbounded memory here.
const MAX_BUFFERED_PTY_EVENTS: usize = 4096;

/// Verifies the server's presented host key against a single pinned
/// fingerprint, the same never-bypass policy as the desktop
/// `HostKeyVerifier` (see `remote_ssh_transport::HostKeyVerifier`).
struct HostKeyVerifier {
    expected_fingerprint_sha256: String,
}

impl client::Handler for HostKeyVerifier {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fingerprint = match server_public_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.fingerprint(HashAlg::Sha256).to_string(),
            PublicKeyOrCertificate::Certificate(cert) => {
                cert.public_key().fingerprint(HashAlg::Sha256).to_string()
            }
        };
        Ok(fingerprint == self.expected_fingerprint_sha256)
    }
}

struct Session {
    handle: Handle<HostKeyVerifier>,
}

/// One open PTY channel plus its bounded event backlog. Read and write
/// halves are split (`russh::Channel::split`) rather than sharing one
/// `Channel` behind a single lock: the reader task holds `wait()` (which
/// needs `&mut self` and blocks until the next message) for the session's
/// entire lifetime, so a write path that had to take the *same* lock would
/// deadlock waiting for a message that a blocked write can never cause to
/// arrive. `write_half`'s methods (`data_bytes`/`window_change`/`close`)
/// take `&self`, so `Arc<ChannelWriteHalf<_>>` needs no lock at all.
struct PtyState {
    write_half: Arc<russh::ChannelWriteHalf<client::Msg>>,
    events: Arc<Mutex<std::collections::VecDeque<PtyEvent>>>,
    /// Signaled by the reader task whenever it pushes a new event, so
    /// `poll_pty_events` can block efficiently instead of busy-polling.
    notify: Arc<tokio::sync::Notify>,
}

pub struct SshClient {
    runtime: tokio::runtime::Runtime,
    sessions: Mutex<HashMap<u64, Session>>,
    ptys: Mutex<HashMap<u64, PtyState>>,
    next_id: AtomicU64,
}

impl SshClient {
    pub fn new() -> Self {
        Self {
            runtime: tokio::runtime::Runtime::new().expect("failed to start tokio runtime"),
            sessions: Mutex::new(HashMap::new()),
            ptys: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn generate_device_key(&self) -> Result<DeviceKeyInfo, SshError> {
        let key = generate_ed25519_private_key()
            .map_err(SshError::KeyMaterialUnavailable)?;

        let public_key_openssh = key
            .public_key()
            .to_openssh()
            .map_err(|e| SshError::KeyMaterialUnavailable(e.to_string()))?;
        let fingerprint_sha256 = key.public_key().fingerprint(HashAlg::Sha256).to_string();

        // Real production usage moves this straight into Keychain / Android
        // Keystore from the native (Swift/Kotlin) bridge layer and never
        // returns it to JS - see mobile/README.md "Status".
        let private_key_pem = key
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .map_err(|e| SshError::KeyMaterialUnavailable(e.to_string()))?
            .to_string();

        Ok(DeviceKeyInfo {
            public_key_openssh,
            fingerprint_sha256,
            private_key_pem,
        })
    }

    pub fn connect(
        &self,
        host: String,
        port: u16,
        username: String,
        private_key_pem: String,
        expected_fingerprint_sha256: String,
    ) -> Result<u64, SshError> {
        let key = PrivateKey::from_openssh(&private_key_pem)
            .map_err(|e| SshError::KeyMaterialUnavailable(e.to_string()))?;

        let handle = self.runtime.block_on(async move {
            let mut handle = open_verified_connection(host, port, expected_fingerprint_sha256).await?;

            let key = Arc::new(key);
            let hash_alg = handle
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten();
            let auth_result = handle
                .authenticate_publickey(username, PrivateKeyWithHashAlg::new(key, hash_alg))
                .await
                .map_err(|e| SshError::AuthenticationFailed(e.to_string()))?;

            require_auth_success(auth_result, "server rejected public key")?;
            Ok(handle)
        })?;

        Ok(self.store_session(handle))
    }

    /// Same as `connect`, but authenticates with a short-lived OpenSSH user
    /// certificate plus its matching private key, per the managed-instance
    /// path in `prds/mobile.md`'s Phase 2 (mirrors desktop's
    /// `authenticate_openssh_cert` in `remote_ssh_transport.rs`).
    pub fn connect_with_certificate(
        &self,
        host: String,
        port: u16,
        username: String,
        private_key_pem: String,
        certificate_openssh: String,
        expected_fingerprint_sha256: String,
    ) -> Result<u64, SshError> {
        let key = PrivateKey::from_openssh(&private_key_pem)
            .map_err(|e| SshError::KeyMaterialUnavailable(e.to_string()))?;
        let cert = russh::keys::Certificate::from_openssh(&certificate_openssh)
            .map_err(|e| SshError::KeyMaterialUnavailable(format!("invalid certificate: {e}")))?;

        let handle = self.runtime.block_on(async move {
            let mut handle = open_verified_connection(host, port, expected_fingerprint_sha256).await?;

            let auth_result = handle
                .authenticate_openssh_cert(username, Arc::new(key), cert)
                .await
                .map_err(|e| SshError::AuthenticationFailed(e.to_string()))?;

            require_auth_success(auth_result, "server rejected certificate")?;
            Ok(handle)
        })?;

        Ok(self.store_session(handle))
    }

    fn store_session(&self, handle: Handle<HostKeyVerifier>) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        self.sessions
            .lock()
            .expect("session map poisoned")
            .insert(id, Session { handle });
        id
    }

    pub fn exec_command(&self, session_id: u64, argv: Vec<String>) -> Result<ExecResult, SshError> {
        let mut sessions = self.sessions.lock().expect("session map poisoned");
        let session = sessions.get_mut(&session_id).ok_or(SshError::SessionNotFound)?;
        let command = shell_words_join(&argv);

        self.runtime.block_on(async {
            let mut channel = session
                .handle
                .channel_open_session()
                .await
                .map_err(|e| SshError::CommandFailed(e.to_string()))?;

            channel
                .exec(true, command.as_str())
                .await
                .map_err(|e| SshError::CommandFailed(e.to_string()))?;

            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            let mut exit_status = -1;

            loop {
                let Some(msg) = channel.wait().await else {
                    break;
                };
                match msg {
                    russh::ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                    russh::ChannelMsg::ExtendedData { data, ext: 1 } => stderr.extend_from_slice(&data),
                    russh::ChannelMsg::ExitStatus { exit_status: status } => {
                        exit_status = status as i32;
                    }
                    russh::ChannelMsg::Close | russh::ChannelMsg::Eof => break,
                    _ => {}
                }
            }

            Ok(ExecResult {
                exit_status,
                stdout: String::from_utf8_lossy(&stdout).into_owned(),
                stderr: String::from_utf8_lossy(&stderr).into_owned(),
            })
        })
    }

    pub fn disconnect(&self, session_id: u64) {
        self.sessions.lock().expect("session map poisoned").remove(&session_id);
    }

    /// Opens a PTY channel on `session_id`'s connection and execs `command`
    /// on it (analogous to desktop's `RemotePtyChannel::open` /
    /// `remote_pty::build_launch_command` — callers pass the already-built
    /// command line, e.g. from `pty-remote attach-command`). Returns an
    /// opaque pty id used by `pty_write`/`pty_resize`/`poll_pty_events`/
    /// `close_pty`. A background reader task streams output into a bounded
    /// backlog (see `poll_pty_events`).
    pub fn open_pty(
        &self,
        session_id: u64,
        term: String,
        cols: u16,
        rows: u16,
        command: String,
    ) -> Result<u64, SshError> {
        // `Handle` is not `Clone` (it owns the connection's reply receiver),
        // so — mirroring `exec_command` above — the sessions lock is held
        // across the `.await` calls that only need `channel_open_session`
        // (which takes `&self`), then dropped once the channel itself
        // (an independent object, not borrowed from `Handle`) is obtained.
        let mut sessions = self.sessions.lock().expect("session map poisoned");
        let session = sessions.get_mut(&session_id).ok_or(SshError::SessionNotFound)?;

        let (channel, events, notify) = self.runtime.block_on(async {
            let channel = session
                .handle
                .channel_open_session()
                .await
                .map_err(|e| SshError::CommandFailed(e.to_string()))?;
            channel
                .request_pty(true, &term, cols as u32, rows as u32, 0, 0, &[])
                .await
                .map_err(|e| SshError::CommandFailed(e.to_string()))?;
            channel
                .exec(true, command.as_str())
                .await
                .map_err(|e| SshError::CommandFailed(e.to_string()))?;
            Ok::<_, SshError>((
                channel,
                Arc::new(Mutex::new(std::collections::VecDeque::new())),
                Arc::new(tokio::sync::Notify::new()),
            ))
        })?;
        drop(sessions);

        let (mut read_half, write_half) = channel.split();
        let write_half = Arc::new(write_half);
        let pty_id = self.next_id.fetch_add(1, Ordering::SeqCst);

        let reader_events = events.clone();
        let reader_notify = notify.clone();
        self.runtime.spawn(async move {
            loop {
                let msg = read_half.wait().await;
                let Some(msg) = msg else {
                    push_event(&reader_events, PtyEvent::Closed, MAX_BUFFERED_PTY_EVENTS);
                    reader_notify.notify_waiters();
                    break;
                };
                match msg {
                    russh::ChannelMsg::Data { data } => {
                        push_event(
                            &reader_events,
                            PtyEvent::Data { bytes: data.to_vec() },
                            MAX_BUFFERED_PTY_EVENTS,
                        );
                        reader_notify.notify_waiters();
                    }
                    russh::ChannelMsg::ExtendedData { data, .. } => {
                        push_event(
                            &reader_events,
                            PtyEvent::Data { bytes: data.to_vec() },
                            MAX_BUFFERED_PTY_EVENTS,
                        );
                        reader_notify.notify_waiters();
                    }
                    russh::ChannelMsg::ExitStatus { exit_status } => {
                        push_event(
                            &reader_events,
                            PtyEvent::ExitStatus { code: exit_status },
                            MAX_BUFFERED_PTY_EVENTS,
                        );
                        reader_notify.notify_waiters();
                    }
                    russh::ChannelMsg::Close | russh::ChannelMsg::Eof => {
                        push_event(&reader_events, PtyEvent::Closed, MAX_BUFFERED_PTY_EVENTS);
                        reader_notify.notify_waiters();
                        break;
                    }
                    _ => {}
                }
            }
        });

        self.ptys.lock().expect("pty map poisoned").insert(
            pty_id,
            PtyState {
                write_half,
                events,
                notify,
            },
        );
        Ok(pty_id)
    }

    /// Writes raw bytes to an open PTY's stdin.
    pub fn pty_write(&self, pty_id: u64, data: Vec<u8>) -> Result<(), SshError> {
        let write_half = {
            let ptys = self.ptys.lock().expect("pty map poisoned");
            ptys.get(&pty_id).ok_or(SshError::SessionNotFound)?.write_half.clone()
        };
        self.runtime.block_on(async move {
            write_half
                .data_bytes(data)
                .await
                .map_err(|e| SshError::CommandFailed(e.to_string()))
        })
    }

    /// Sends a window-change request so the remote PTY (and, when the
    /// remote command is `pty-remote attach-command`'s tmux/screen session,
    /// the persistent session itself) resizes to match the client's
    /// terminal.
    pub fn pty_resize(&self, pty_id: u64, cols: u16, rows: u16) -> Result<(), SshError> {
        let write_half = {
            let ptys = self.ptys.lock().expect("pty map poisoned");
            ptys.get(&pty_id).ok_or(SshError::SessionNotFound)?.write_half.clone()
        };
        self.runtime.block_on(async move {
            write_half
                .window_change(cols as u32, rows as u32, 0, 0)
                .await
                .map_err(|e| SshError::CommandFailed(e.to_string()))
        })
    }

    /// Drains up to `max_events` buffered [`PtyEvent`]s, blocking up to
    /// `timeout_ms` if none are yet available (returns immediately once at
    /// least one event is ready, or once the timeout elapses with an empty
    /// result — never blocks past `timeout_ms`).
    ///
    /// ## Spike result: why polling, not a UniFFI async callback interface
    ///
    /// UniFFI has supported callback interfaces (Kotlin/Swift objects Rust
    /// calls into) since well before 0.28, and later versions added
    /// `async` support for them — but only on the proc-macro (`uniffi::*`
    /// attribute) generation path. This crate is on the UDL scaffolding
    /// path (`uniffi::include_scaffolding!`, see `build.rs`), where
    /// `[Trait]`/callback interfaces backing a `Fn(PtyEvent)`-style push
    /// callback are not available at the pinned `uniffi = "0.28"` version
    /// used here — migrating to the proc-macro path is a larger, separate
    /// change (it touches every existing method's generated bindings and
    /// the Kotlin/Swift FFI test programs in `ffi-tests/`), not something
    /// to fold into a PTY-only change. So: events are buffered VM-side
    /// (bounded, see `MAX_BUFFERED_PTY_EVENTS`) and the native bridge polls
    /// this method from a background thread/coroutine — the same shape
    /// mobile's `AgentScreen` already uses for `agent-remote status`/`logs`
    /// polling, so the pattern is not new to this codebase.
    pub fn poll_pty_events(&self, pty_id: u64, timeout_ms: u64, max_events: u32) -> Result<Vec<PtyEvent>, SshError> {
        let (events, notify) = {
            let ptys = self.ptys.lock().expect("pty map poisoned");
            let state = ptys.get(&pty_id).ok_or(SshError::SessionNotFound)?;
            (state.events.clone(), state.notify.clone())
        };

        self.runtime.block_on(async move {
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
            loop {
                {
                    let mut queue = events.lock().expect("pty event queue poisoned");
                    if !queue.is_empty() {
                        let take = queue.len().min(max_events as usize);
                        let drained = queue.drain(..take).collect();
                        return Ok(drained);
                    }
                }
                let now = tokio::time::Instant::now();
                if now >= deadline {
                    return Ok(vec![]);
                }
                let _ = tokio::time::timeout(deadline - now, notify.notified()).await;
            }
        })
    }

    /// Closes a PTY session. Idempotent, mirroring desktop's
    /// `RemotePtyManager::close` convention.
    pub fn close_pty(&self, pty_id: u64) {
        let removed = self.ptys.lock().expect("pty map poisoned").remove(&pty_id);
        if let Some(state) = removed {
            self.runtime.block_on(async move {
                let _ = state.write_half.close().await;
            });
        }
    }
}

fn push_event(
    events: &Arc<Mutex<std::collections::VecDeque<PtyEvent>>>,
    event: PtyEvent,
    max_len: usize,
) {
    let mut queue = events.lock().expect("pty event queue poisoned");
    if queue.len() >= max_len {
        queue.pop_front();
    }
    queue.push_back(event);
}

/// Opens a TCP+SSH connection and verifies the server's host key against
/// `expected_fingerprint_sha256` (via `HostKeyVerifier`) before any
/// credentials are sent, shared by both `connect` and
/// `connect_with_certificate`.
async fn open_verified_connection(
    host: String,
    port: u16,
    expected_fingerprint_sha256: String,
) -> Result<Handle<HostKeyVerifier>, SshError> {
    let config = Arc::new(client::Config::default());
    let handler = HostKeyVerifier {
        expected_fingerprint_sha256,
    };
    client::connect(config, (host.as_str(), port), handler)
        .await
        .map_err(|e| SshError::ConnectionFailed(e.to_string()))
}

fn require_auth_success(result: AuthResult, rejection_message: &str) -> Result<(), SshError> {
    match result {
        AuthResult::Success => Ok(()),
        AuthResult::Failure { .. } => Err(SshError::AuthenticationFailed(rejection_message.to_string())),
    }
}

fn generate_ed25519_private_key() -> Result<PrivateKey, String> {
    use getrandom::SysRng;
    use rand_core::UnwrapErr;
    PrivateKey::random(&mut UnwrapErr(SysRng), russh::keys::Algorithm::Ed25519)
        .map_err(|e| format!("failed to generate device key: {e}"))
}

fn shell_words_join(argv: &[String]) -> String {
    argv.iter()
        .map(|arg| format!("'{}'", arg.replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join(" ")
}

/// In-process mock SSH server shared by the crate's own unit tests and, via
/// the `ffi-tests` feature, the `mock_ssh_server` example binary that the
/// Kotlin/Swift FFI CI jobs (`.github/workflows/mobile.yml`) run against to
/// exercise the *real* compiled library from real Kotlin/Swift code rather
/// than a JS/mock stand-in. Not compiled into ordinary builds of the crate.
#[cfg(any(test, feature = "ffi-tests"))]
pub mod mock_server {
    use crate::generate_ed25519_private_key;
    use russh::keys::PrivateKey;
    use russh::server::{self, Msg as ServerMsg, Server as _, Session as ServerSession};
    use russh::{Channel, ChannelId};
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    pub fn test_host_key() -> PrivateKey {
        generate_ed25519_private_key().unwrap()
    }

    /// Signs a throwaway OpenSSH user certificate for `public_key_openssh`,
    /// the same way `connect_with_certificate_round_trips_through_a_real_ssh_session`
    /// does - a real certificate, just signed by an in-test CA rather than
    /// the control plane's signing service. Lets the Kotlin/Swift FFI test
    /// programs (which have no OpenSSH-certificate-building library of
    /// their own) exercise `connect_with_certificate` with a real
    /// certificate by shelling out to `mock_ssh_server sign-cert
    /// <public_key_openssh>` for one, rather than only the Rust unit test
    /// covering that code path.
    pub fn sign_test_certificate(public_key_openssh: &str) -> Result<String, String> {
        use russh::keys::ssh_key::certificate::{Builder, CertType};
        use russh::keys::ssh_key::PublicKey;

        let subject_key = PublicKey::from_openssh(public_key_openssh)
            .map_err(|e| format!("invalid public key: {e}"))?;
        let ca_key = generate_ed25519_private_key()?;

        let mut builder = Builder::new(
            [0u8; 32],
            subject_key.key_data().clone(),
            0,
            u64::MAX,
        )
        .map_err(|e| format!("failed to build certificate: {e}"))?;
        builder
            .cert_type(CertType::User)
            .map_err(|e| format!("failed to set cert type: {e}"))?;
        builder
            .valid_principal("treq")
            .map_err(|e| format!("failed to set valid principal: {e}"))?;
        let cert = builder
            .sign(&ca_key)
            .map_err(|e| format!("failed to sign certificate: {e}"))?;
        cert.to_openssh().map_err(|e| format!("failed to encode certificate: {e}"))
    }

    #[derive(Clone)]
    struct MockServer {
        call_count: Arc<AtomicUsize>,
        /// Simulates a tmux/screen session's scrollback surviving across a
        /// detach + reconnect: keyed by the session label embedded in a
        /// `pty-echo:<label>` exec command, shared across every connection
        /// this `MockServer` accepts (mirroring how a real `pty-remote`
        /// session lives on the VM independent of any one SSH connection).
        pty_backlogs: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    }

    impl server::Server for MockServer {
        type Handler = MockHandler;
        fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> MockHandler {
            MockHandler {
                call_count: self.call_count.clone(),
                pty_backlogs: self.pty_backlogs.clone(),
                pty_requested: false,
                active_backlog_key: None,
            }
        }
    }

    struct MockHandler {
        call_count: Arc<AtomicUsize>,
        pty_backlogs: Arc<Mutex<HashMap<String, Vec<u8>>>>,
        /// Set by `pty_request`; `exec_request` uses this to decide whether
        /// to behave like the plain exec-once-and-close fixture or the
        /// PTY-echo-and-stay-open fixture the reattach test below exercises.
        pty_requested: bool,
        /// Set once `exec_request` recognizes a `pty-echo:<label>` command;
        /// `data()` uses it to know which backlog to append echoed bytes to.
        active_backlog_key: Option<String>,
    }

    impl server::Handler for MockHandler {
        type Error = russh::Error;

        async fn auth_publickey(
            &mut self,
            _user: &str,
            _key: &russh::keys::ssh_key::PublicKey,
        ) -> Result<server::Auth, Self::Error> {
            Ok(server::Auth::Accept)
        }

        async fn auth_openssh_certificate(
            &mut self,
            _user: &str,
            _certificate: &russh::keys::Certificate,
        ) -> Result<server::Auth, Self::Error> {
            Ok(server::Auth::Accept)
        }

        async fn channel_open_session(
            &mut self,
            _channel: Channel<ServerMsg>,
            reply: server::ChannelOpenHandle,
            _session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            reply.accept().await;
            Ok(())
        }

        async fn pty_request(
            &mut self,
            channel: ChannelId,
            _term: &str,
            _col_width: u32,
            _row_height: u32,
            _pix_width: u32,
            _pix_height: u32,
            _modes: &[(russh::Pty, u32)],
            session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            self.pty_requested = true;
            session.channel_success(channel)?;
            Ok(())
        }

        async fn window_change_request(
            &mut self,
            channel: ChannelId,
            _col_width: u32,
            _row_height: u32,
            _pix_width: u32,
            _pix_height: u32,
            session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            session.channel_success(channel)?;
            Ok(())
        }

        async fn exec_request(
            &mut self,
            channel: ChannelId,
            data: &[u8],
            session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            let command = String::from_utf8_lossy(data).to_string();
            session.channel_success(channel)?;

            // `open_pty` PTY-mode commands (`pty-echo:<label>`): stay open
            // and echo interactively, replaying any backlog a *previous*
            // connection for the same label left behind — the mock
            // stand-in for tmux/screen's reattach-shows-scrollback
            // behavior `pty_remote_supervisor::build_attach_command`
            // relies on server-side.
            if self.pty_requested {
                if let Some(label) = command.strip_prefix("pty-echo:") {
                    self.active_backlog_key = Some(label.to_string());
                    let backlog = self
                        .pty_backlogs
                        .lock()
                        .unwrap()
                        .get(label)
                        .cloned()
                        .unwrap_or_default();
                    if !backlog.is_empty() {
                        session.data(channel, bytes::Bytes::from(backlog))?;
                    }
                    return Ok(());
                }
            }

            let response = fixture_response(&command);
            session.data(channel, bytes::Bytes::from(response.into_bytes()))?;
            session.exit_status_request(channel, 0)?;
            session.close(channel)?;
            Ok(())
        }

        async fn data(
            &mut self,
            channel: ChannelId,
            data: &[u8],
            session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            let Some(label) = self.active_backlog_key.clone() else {
                return Ok(());
            };
            if data == b"__exit__" {
                session.exit_status_request(channel, 0)?;
                session.close(channel)?;
                return Ok(());
            }
            self.pty_backlogs
                .lock()
                .unwrap()
                .entry(label)
                .or_default()
                .extend_from_slice(data);
            session.data(channel, bytes::Bytes::from(data.to_vec()))?;
            Ok(())
        }
    }

    /// Recognizes the Phase 3 `treq <command> <action> ... --format json`
    /// invocations mobile's `src/lib/treqCli.ts` sends (see
    /// `prds/mobile.md` Phase 3 and `src-tauri/src/core/remote.rs`'s
    /// `cli_args()` for the desktop shapes this mirrors) and returns
    /// realistic fixture JSON for each, so the rn-real-ssh Jest suite can
    /// exercise the real screens' request/response parsing end to end.
    /// Anything else falls back to the original echo behavior, which the
    /// crate's own unit tests and the Kotlin/Swift FFI tests still rely on.
    fn fixture_response(command: &str) -> String {
        // `starts_with`, not `contains`: the crate's own unit tests and the
        // Kotlin/Swift FFI tests send `["treq", "workspace", "list"]`
        // (quoted as `'treq' 'workspace' 'list'`) and assert on the echoed
        // command - `contains("'workspace' 'list'")` would wrongly match
        // that too, since it's a substring of the `'treq' ...` command.
        // treqCli.ts's argv never includes a leading `treq` token, so its
        // commands start with the action pair directly.
        if command.starts_with("'workspace' 'list'") {
            return r#"[{"id":7,"workspace_name":"feature-x","branch_name":"feature-x","title":"Feature X","target_branch":"main","archived":false}]"#.to_string();
        }
        if command.starts_with("'changes' 'diff'") {
            // The `src/a.rs` fixture path (also the one `conflicts list`
            // reports below) carries a conflict region, so a real UI test
            // can follow Conflicts -> Diff and see real conflict-marker
            // content, not just an empty list.
            if command.contains("'src/a.rs'") {
                return r#"[{"id":"h1","header":"@@ -1,3 +1,4 @@","lines":["<<<<<<<"],"patch":"<<<<<<<\n","conflict_style":"Legacy","conflict_regions":[{"id":"c1","file_path":"src/a.rs","conflict_number":1,"total_conflicts":1,"start_line":1,"end_line":5,"marker_style":"Legacy","content":"<<<<<<< left\n=======\nright\n>>>>>>>","lines":[],"line_map":[],"comparison":{}}]}]"#.to_string();
            }
            return r#"[{"id":"h1","header":"@@ -1,3 +1,4 @@","lines":["+added"],"patch":"+added\n","conflict_style":"Legacy","conflict_regions":[]}]"#.to_string();
        }
        if command.starts_with("'changes' 'list'") {
            return r#"[{"path":"src/lib.rs","status":"modified","previous_path":null,"changed_line_count":4,"diff_deferred":false}]"#.to_string();
        }
        if command.starts_with("'commits' 'list'") {
            return r#"{"commits":[{"commit_id":"abc123","short_id":"abc","change_id":"zzz","description":"Add feature","author_name":"Ada","timestamp":"2026-01-01T00:00:00Z","parent_ids":[],"is_working_copy":true,"bookmarks":["main"],"is_immutable":false,"insertions":3,"deletions":1,"has_conflicts":false}],"target_branch":"main","workspace_branch":"feature-x"}"#.to_string();
        }
        if command.starts_with("'conflicts' 'list'") {
            return r#"["src/a.rs"]"#.to_string();
        }
        if command.starts_with("'file' 'read'") {
            let revision = if command.contains("'parent'") { "parent" } else { "working-copy" };
            return format!(
                r#"{{"lines":["fn main() {{","    // {revision} revision","}}"],"start_line":1,"end_line":3}}"#
            );
        }
        format!("{{\"echo\":\"{command}\"}}")
    }

    /// Binds on `bind_addr` (use `"127.0.0.1:0"` for an OS-assigned port)
    /// and serves forever in a background task. Returns the bound address
    /// and the host key so a caller can compute the expected fingerprint.
    pub async fn start_mock_server(bind_addr: &str) -> (std::net::SocketAddr, PrivateKey) {
        let host_key = test_host_key();
        let mut config = server::Config::default();
        config.keys.push(host_key.clone());
        config.auth_rejection_time = Duration::from_millis(10);
        let config = Arc::new(config);

        let listener = tokio::net::TcpListener::bind(bind_addr).await.unwrap();
        let addr = listener.local_addr().unwrap();

        let mut server = MockServer {
            call_count: Arc::new(AtomicUsize::new(0)),
            pty_backlogs: Arc::new(Mutex::new(HashMap::new())),
        };

        tokio::spawn(async move {
            loop {
                let Ok((socket, peer)) = listener.accept().await else {
                    break;
                };
                let handler = server.new_client(Some(peer));
                let config = config.clone();
                tokio::spawn(async move {
                    let _ = server::run_stream(config, socket, handler).await;
                });
            }
        });

        (addr, host_key)
    }
}

#[cfg(test)]
mod tests {
    use super::mock_server::start_mock_server;
    use super::*;

    #[test]
    fn generates_a_valid_ed25519_device_key() {
        let client = SshClient::new();
        let info = client.generate_device_key().unwrap();
        assert!(info.public_key_openssh.starts_with("ssh-ed25519 "));
        assert!(info.fingerprint_sha256.starts_with("SHA256:"));
        assert!(info.private_key_pem.contains("BEGIN OPENSSH PRIVATE KEY"));
    }

    #[test]
    fn connect_rejects_mismatched_host_key_fingerprint() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (addr, _host_key) = runtime.block_on(start_mock_server("127.0.0.1:0"));

        let client = SshClient::new();
        let device_key = client.generate_device_key().unwrap();

        let result = client.connect(
            addr.ip().to_string(),
            addr.port(),
            "treq".to_string(),
            device_key.private_key_pem,
            "SHA256:not-the-real-fingerprint".to_string(),
        );

        assert!(matches!(result, Err(SshError::ConnectionFailed(_))));
    }

    /// Phase 6 of prds/mobile.md ("host-key mismatch and rotation tests"):
    /// a client that pinned a fingerprint from a previous connection must
    /// reject a server now presenting a *different* key at the same
    /// address - the same mismatch path as
    /// `connect_rejects_mismatched_host_key_fingerprint`, but exercised
    /// against a real rotated server rather than a fabricated fingerprint
    /// string, and followed by a successful reconnect once the client
    /// re-pins the new fingerprint (the real-world flow: rotation is
    /// detected, the user re-verifies out of band, then trusts the new key).
    #[test]
    fn connect_rejects_a_rotated_host_key_then_succeeds_once_repinned() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (old_addr, old_host_key) = runtime.block_on(start_mock_server("127.0.0.1:0"));
        let old_fingerprint = old_host_key.public_key().fingerprint(HashAlg::Sha256).to_string();

        let client = SshClient::new();
        let device_key = client.generate_device_key().unwrap();

        // Simulate the server rotating its host key by standing up a fresh
        // mock server (a new random key, per `test_host_key`) at a new
        // address, and reusing the *old* pinned fingerprint against it.
        let (new_addr, new_host_key) = runtime.block_on(start_mock_server("127.0.0.1:0"));
        let new_fingerprint = new_host_key.public_key().fingerprint(HashAlg::Sha256).to_string();
        assert_ne!(old_fingerprint, new_fingerprint, "test setup requires two distinct host keys");

        let stale_pin_result = client.connect(
            new_addr.ip().to_string(),
            new_addr.port(),
            "treq".to_string(),
            device_key.private_key_pem.clone(),
            old_fingerprint,
        );
        assert!(matches!(stale_pin_result, Err(SshError::ConnectionFailed(_))));

        // The original server (unrotated) is still reachable under its own
        // fingerprint - rotation of one endpoint doesn't invalidate others.
        let old_still_works = client.connect(
            old_addr.ip().to_string(),
            old_addr.port(),
            "treq".to_string(),
            device_key.private_key_pem.clone(),
            old_host_key.public_key().fingerprint(HashAlg::Sha256).to_string(),
        );
        assert!(old_still_works.is_ok());

        // Re-pinning the new fingerprint lets the client trust the rotated
        // server going forward.
        let repinned_result = client.connect(
            new_addr.ip().to_string(),
            new_addr.port(),
            "treq".to_string(),
            device_key.private_key_pem,
            new_fingerprint,
        );
        assert!(repinned_result.is_ok());
    }

    #[test]
    fn connect_and_exec_round_trips_through_a_real_ssh_session() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (addr, host_key) = runtime.block_on(start_mock_server("127.0.0.1:0"));
        let expected_fingerprint = host_key.public_key().fingerprint(HashAlg::Sha256).to_string();

        let client = SshClient::new();
        let device_key = client.generate_device_key().unwrap();

        let session_id = client
            .connect(
                addr.ip().to_string(),
                addr.port(),
                "treq".to_string(),
                device_key.private_key_pem,
                expected_fingerprint,
            )
            .expect("connect should succeed against the mock server");

        let result = client
            .exec_command(session_id, vec!["treq".to_string(), "workspace".to_string(), "list".to_string()])
            .expect("exec should succeed on the open session");

        assert_eq!(result.exit_status, 0);
        assert!(result.stdout.contains("'treq' 'workspace' 'list'"));

        client.disconnect(session_id);
        let second_attempt = client.exec_command(session_id, vec!["treq".to_string()]);
        assert!(matches!(second_attempt, Err(SshError::SessionNotFound)));
    }

    #[test]
    fn connect_with_certificate_round_trips_through_a_real_ssh_session() {
        use russh::keys::ssh_key::certificate::{Builder, CertType};

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (addr, host_key) = runtime.block_on(start_mock_server("127.0.0.1:0"));
        let expected_fingerprint = host_key.public_key().fingerprint(HashAlg::Sha256).to_string();

        let client = SshClient::new();
        let device_key = client.generate_device_key().unwrap();
        let subject_key = PrivateKey::from_openssh(&device_key.private_key_pem).unwrap();

        // A real, freshly-signed OpenSSH user certificate - built the same
        // way Supabase's `issue_certificate` edge function would, just with
        // an in-test throwaway CA instead of the control plane's signing
        // service. Proves `connect_with_certificate` parses and presents a
        // real certificate over a real SSH session, not just that it
        // compiles.
        let ca_key = generate_ed25519_private_key().unwrap();
        let mut builder = Builder::new(
            [0u8; 32],
            subject_key.public_key().key_data().clone(),
            0,
            u64::MAX,
        )
        .unwrap();
        builder.cert_type(CertType::User).unwrap();
        builder.valid_principal("treq").unwrap();
        let cert = builder.sign(&ca_key).unwrap();
        let cert_openssh = cert.to_openssh().unwrap();

        let session_id = client
            .connect_with_certificate(
                addr.ip().to_string(),
                addr.port(),
                "treq".to_string(),
                device_key.private_key_pem,
                cert_openssh,
                expected_fingerprint,
            )
            .expect("certificate connect should succeed against the mock server");

        let result = client
            .exec_command(session_id, vec!["treq".to_string(), "workspace".to_string(), "list".to_string()])
            .expect("exec should succeed on the certificate-authenticated session");
        assert_eq!(result.exit_status, 0);

        client.disconnect(session_id);
    }

    #[test]
    fn connect_with_certificate_rejects_a_malformed_certificate() {
        let client = SshClient::new();
        let device_key = client.generate_device_key().unwrap();

        let result = client.connect_with_certificate(
            "127.0.0.1".to_string(),
            2222,
            "treq".to_string(),
            device_key.private_key_pem,
            "not-a-real-certificate".to_string(),
            "SHA256:whatever".to_string(),
        );

        assert!(matches!(result, Err(SshError::KeyMaterialUnavailable(_))));
    }

    /// Establishes a real SSH session against the mock server, opens a PTY
    /// on it, writes bytes, and reads them back through `poll_pty_events` —
    /// exercising `open_pty`/`pty_write`/`pty_resize`/`poll_pty_events`/
    /// `close_pty` end to end (mobile PRD Phase 7, item 2).
    #[test]
    fn open_pty_write_and_poll_round_trip_through_a_real_ssh_session() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (addr, host_key) = runtime.block_on(start_mock_server("127.0.0.1:0"));
        let expected_fingerprint = host_key.public_key().fingerprint(HashAlg::Sha256).to_string();

        let client = SshClient::new();
        let device_key = client.generate_device_key().unwrap();
        let session_id = client
            .connect(
                addr.ip().to_string(),
                addr.port(),
                "treq".to_string(),
                device_key.private_key_pem,
                expected_fingerprint,
            )
            .unwrap();

        let pty_id = client
            .open_pty(session_id, "xterm-256color".to_string(), 80, 24, "pty-echo:round-trip".to_string())
            .expect("open_pty should succeed against the mock server");

        client.pty_write(pty_id, b"hello\n".to_vec()).unwrap();
        client.pty_resize(pty_id, 100, 40).unwrap();

        // Poll until the echoed data shows up (bounded by a generous
        // overall timeout across a few short polls, since a single
        // `poll_pty_events` call already blocks up to its own timeout).
        let mut collected = Vec::new();
        for _ in 0..20 {
            let events = client.poll_pty_events(pty_id, 500, 16).unwrap();
            for event in events {
                if let PtyEvent::Data { bytes } = event {
                    collected.extend_from_slice(&bytes);
                }
            }
            if collected.windows(6).any(|w| w == b"hello\n") {
                break;
            }
        }
        assert!(
            collected.windows(6).any(|w| w == b"hello\n"),
            "expected echoed bytes to include the written data, got: {collected:?}"
        );

        client.pty_write(pty_id, b"__exit__".to_vec()).unwrap();
        // Draining until Closed confirms the reader task observed the
        // channel end after the mock server's exit_status_request + close.
        let mut saw_closed = false;
        for _ in 0..20 {
            let events = client.poll_pty_events(pty_id, 500, 16).unwrap();
            if events.iter().any(|e| matches!(e, PtyEvent::Closed | PtyEvent::ExitStatus { .. })) {
                saw_closed = true;
                break;
            }
        }
        assert!(saw_closed, "expected a Closed/ExitStatus event after __exit__");

        client.close_pty(pty_id);
        // Idempotent.
        client.close_pty(pty_id);
    }

    /// Mobile PRD Phase 7's reattach scenario: a second PTY session opened
    /// against the *same backend label* (mirroring `pty-remote attach`
    /// reattaching to a still-running tmux/screen session after the app
    /// was backgrounded or the connection dropped) replays whatever
    /// backlog the first session produced, before any new bytes are
    /// written on the new connection — the same guarantee tmux's
    /// scrollback gives a real reattach.
    #[test]
    fn reattach_replays_backlog_from_a_prior_session() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (addr, host_key) = runtime.block_on(start_mock_server("127.0.0.1:0"));
        let expected_fingerprint = host_key.public_key().fingerprint(HashAlg::Sha256).to_string();

        let client = SshClient::new();
        let device_key = client.generate_device_key().unwrap();
        let session_id = client
            .connect(
                addr.ip().to_string(),
                addr.port(),
                "treq".to_string(),
                device_key.private_key_pem.clone(),
                expected_fingerprint.clone(),
            )
            .unwrap();

        let first_pty = client
            .open_pty(
                session_id,
                "xterm-256color".to_string(),
                80,
                24,
                "pty-echo:reattach-scenario".to_string(),
            )
            .unwrap();
        client.pty_write(first_pty, b"first-session-output\n".to_vec()).unwrap();

        // Wait for the echo to land (and therefore be recorded in the
        // shared backlog) before simulating a detach.
        let mut seen_first = false;
        for _ in 0..20 {
            let events = client.poll_pty_events(first_pty, 500, 16).unwrap();
            if events.iter().any(|e| matches!(e, PtyEvent::Data { bytes } if bytes.windows(20).any(|w| w == b"first-session-output"))) {
                seen_first = true;
                break;
            }
        }
        assert!(seen_first, "expected the first session's write to be echoed");

        // Simulate detach: close this pty (and the underlying SSH session)
        // without ever "stopping" the backend session — a real
        // `pty-remote` session survives exactly this the same way tmux
        // does.
        client.close_pty(first_pty);
        client.disconnect(session_id);

        // Reconnect (a fresh SSH session, as a relaunch of the app would
        // establish) and open a PTY against the *same* backend label.
        let second_session_id = client
            .connect(
                addr.ip().to_string(),
                addr.port(),
                "treq".to_string(),
                device_key.private_key_pem,
                expected_fingerprint,
            )
            .unwrap();
        let second_pty = client
            .open_pty(
                second_session_id,
                "xterm-256color".to_string(),
                80,
                24,
                "pty-echo:reattach-scenario".to_string(),
            )
            .unwrap();

        let mut replayed = Vec::new();
        for _ in 0..20 {
            let events = client.poll_pty_events(second_pty, 500, 16).unwrap();
            for event in events {
                if let PtyEvent::Data { bytes } = event {
                    replayed.extend_from_slice(&bytes);
                }
            }
            if replayed.windows(20).any(|w| w == b"first-session-output") {
                break;
            }
        }
        assert!(
            replayed.windows(20).any(|w| w == b"first-session-output"),
            "expected the reattached session to replay the prior session's backlog, got: {replayed:?}"
        );

        client.close_pty(second_pty);
        client.disconnect(second_session_id);
    }
}
