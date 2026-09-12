//! Mobile SSH bridge crate for the `mobile/` React Native app.
//!
//! Mirrors `src-tauri/src/core/remote_ssh_transport.rs`'s use of `russh` for
//! the desktop app, but exposed through a UniFFI interface so it can be
//! compiled as a static/shared library and called from Swift (iOS) and
//! Kotlin (Android) native modules, per the pattern described in
//! https://rust-dd.com/post/building-a-rust-native-module-for-react-native-on-ios-and-android.
//!
//! Scope (first milestone, see `prds/mobile.md` Phase 2): device key
//! generation and a manual host/port/key connect + exec flow. Certificate
//! issuance and the Supabase control plane are not wired here yet.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use russh::client::{self, Handle};
use russh_keys::key::{KeyPair, PublicKey};
use russh_keys::PublicKeyBase64;
use tokio::runtime::Runtime;

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

struct HostKeyVerifier {
    expected_fingerprint_sha256: String,
}

#[async_trait::async_trait]
impl client::Handler for HostKeyVerifier {
    type Error = russh::Error;

    async fn check_server_key(&mut self, server_public_key: &PublicKey) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint();
        Ok(fingerprint == self.expected_fingerprint_sha256)
    }
}

struct Session {
    handle: Handle<HostKeyVerifier>,
}

pub struct SshClient {
    runtime: Runtime,
    sessions: Mutex<HashMap<u64, Session>>,
    next_id: AtomicU64,
}

impl SshClient {
    pub fn new() -> Self {
        Self {
            runtime: Runtime::new().expect("failed to start tokio runtime"),
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn generate_device_key(&self) -> Result<DeviceKeyInfo, SshError> {
        let key_pair = KeyPair::generate_ed25519()
            .ok_or_else(|| SshError::KeyMaterialUnavailable("ed25519 key generation failed".into()))?;

        let public_key_openssh = key_pair
            .clone_public_key()
            .map_err(|e| SshError::KeyMaterialUnavailable(e.to_string()))?
            .public_key_base64();

        let fingerprint_sha256 = key_pair
            .clone_public_key()
            .map_err(|e| SshError::KeyMaterialUnavailable(e.to_string()))?
            .fingerprint();

        // Real OpenSSH private-key PEM encoding is deferred to the
        // russh-keys serialization helpers; the native (Swift/Kotlin)
        // caller must move this value straight into Keychain / Android
        // Keystore and never pass it back across the JS bridge.
        let private_key_pem = format!("{key_pair:?}");

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
        let key_pair = russh_keys::decode_secret_key(&private_key_pem, None)
            .map_err(|e| SshError::KeyMaterialUnavailable(e.to_string()))?;

        let config = Arc::new(client::Config::default());
        let handler = HostKeyVerifier {
            expected_fingerprint_sha256,
        };

        let handle = self.runtime.block_on(async move {
            let mut handle = client::connect(config, (host.as_str(), port), handler)
                .await
                .map_err(|e| SshError::ConnectionFailed(e.to_string()))?;

            let authenticated = handle
                .authenticate_publickey(username, Arc::new(key_pair))
                .await
                .map_err(|e| SshError::AuthenticationFailed(e.to_string()))?;

            if !authenticated {
                return Err(SshError::AuthenticationFailed(
                    "server rejected public key".into(),
                ));
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

            while let Some(msg) = channel.wait().await {
                match msg {
                    russh::ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                    russh::ChannelMsg::ExtendedData { data, ext: 1 } => stderr.extend_from_slice(&data),
                    russh::ChannelMsg::ExitStatus { exit_status: status } => {
                        exit_status = status as i32;
                    }
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

fn shell_words_join(argv: &[String]) -> String {
    argv.iter()
        .map(|arg| format!("'{}'", arg.replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join(" ")
}
