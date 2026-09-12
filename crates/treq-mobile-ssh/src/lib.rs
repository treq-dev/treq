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

        let config = Arc::new(client::Config::default());
        let handler = HostKeyVerifier {
            expected_fingerprint_sha256,
        };

        let handle = self.runtime.block_on(async move {
            let mut handle = client::connect(config, (host.as_str(), port), handler)
                .await
                .map_err(|e| SshError::ConnectionFailed(e.to_string()))?;

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

            match auth_result {
                AuthResult::Success => {}
                AuthResult::Failure { .. } => {
                    return Err(SshError::AuthenticationFailed(
                        "server rejected public key".into(),
                    ));
                }
            }

            Ok(handle)
        })?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        self.sessions
            .lock()
            .expect("session map poisoned")
            .insert(id, Session { handle });
        Ok(id)
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
            let response = format!("{{\"echo\":\"{command}\"}}");
            session.data(channel, bytes::Bytes::from(response.into_bytes()))?;
            session.exit_status_request(channel, 0)?;
            session.close(channel)?;
            Ok(())
        }
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
}
