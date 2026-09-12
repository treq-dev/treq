//! N-API bridge (feature `napi`) exposing `SshClient` to Node, so Jest can
//! call the real Rust SSH implementation instead of a hand-written JS mock
//! of the native module boundary - see mobile/src/native/__tests__ and
//! mobile/README.md "What's tested" for how this is used and its limits.
//!
//! This does not simulate, and is not meant to simulate, the Swift/Kotlin
//! marshalling those platforms' native modules do (`TreqSshBridge.swift`,
//! `TreqSshModule.kt`) - see those files and `.github/workflows/mobile.yml`
//! for what actually exercises that layer. What this proves is that the
//! *business logic* driven by `mobile/src/screens/*` - argument shapes,
//! error propagation, the SSH calls themselves - is real, not stubbed.

use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::{DeviceKeyInfo, ExecResult, SshClient as CoreSshClient, SshError};

fn map_error(error: SshError) -> Error {
    Error::from_reason(error.to_string())
}

#[napi(object)]
pub struct NapiDeviceKeyInfo {
    pub public_key_openssh: String,
    pub fingerprint_sha256: String,
    pub private_key_pem: String,
}

impl From<DeviceKeyInfo> for NapiDeviceKeyInfo {
    fn from(info: DeviceKeyInfo) -> Self {
        Self {
            public_key_openssh: info.public_key_openssh,
            fingerprint_sha256: info.fingerprint_sha256,
            private_key_pem: info.private_key_pem,
        }
    }
}

#[napi(object)]
pub struct NapiExecResult {
    pub exit_status: i32,
    pub stdout: String,
    pub stderr: String,
}

impl From<ExecResult> for NapiExecResult {
    fn from(result: ExecResult) -> Self {
        Self {
            exit_status: result.exit_status,
            stdout: result.stdout,
            stderr: result.stderr,
        }
    }
}

#[napi]
pub struct SshClient {
    inner: CoreSshClient,
}

#[napi]
impl SshClient {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: CoreSshClient::new(),
        }
    }

    #[napi]
    pub fn generate_device_key(&self) -> Result<NapiDeviceKeyInfo> {
        self.inner
            .generate_device_key()
            .map(Into::into)
            .map_err(map_error)
    }

    #[napi]
    pub fn connect(
        &self,
        host: String,
        port: u16,
        username: String,
        private_key_pem: String,
        expected_fingerprint_sha256: String,
    ) -> Result<BigInt> {
        let session_id = self
            .inner
            .connect(host, port, username, private_key_pem, expected_fingerprint_sha256)
            .map_err(map_error)?;
        Ok(BigInt::from(session_id))
    }

    #[napi]
    pub fn exec_command(&self, session_id: BigInt, argv: Vec<String>) -> Result<NapiExecResult> {
        let (_, id, _) = session_id.get_u64();
        self.inner
            .exec_command(id, argv)
            .map(Into::into)
            .map_err(map_error)
    }

    #[napi]
    pub fn disconnect(&self, session_id: BigInt) {
        let (_, id, _) = session_id.get_u64();
        self.inner.disconnect(id);
    }
}
