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

pub struct SshClient {
    runtime: tokio::runtime::Runtime,
    sessions: Mutex<HashMap<u64, Session>>,
    next_id: AtomicU64,
}

impl SshClient {
    pub fn new() -> Self {
        Self {
            runtime: tokio::runtime::Runtime::new().expect("failed to start tokio runtime"),
            sessions: Mutex::new(HashMap::new()),
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
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
    }

    impl server::Server for MockServer {
        type Handler = MockHandler;
        fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> MockHandler {
            MockHandler {
                call_count: self.call_count.clone(),
            }
        }
    }

    struct MockHandler {
        call_count: Arc<AtomicUsize>,
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

        async fn exec_request(
            &mut self,
            channel: ChannelId,
            data: &[u8],
            session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            let command = String::from_utf8_lossy(data).to_string();
            session.channel_success(channel)?;
            let response = fixture_response(&command);
            session.data(channel, bytes::Bytes::from(response.into_bytes()))?;
            session.exit_status_request(channel, 0)?;
            session.close(channel)?;
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
}
