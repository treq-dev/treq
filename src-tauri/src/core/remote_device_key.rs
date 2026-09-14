//! Mobile device SSH key generation and storage.
//!
//! Desktop identifies with the user's existing `~/.ssh` keys (see
//! `remote_local_keys`). Mobile has no such directory and no user-facing
//! concept of one, so the app generates a dedicated ed25519 keypair per
//! device the first time it is needed.
//!
//! Private key storage is platform-specific:
//! - On mobile (Android/iOS), the private key is stored in the OS-native
//!   keystore/keychain via `tauri-plugin-keystore`, gated on the device
//!   having biometrics set up (`tauri-plugin-biometric`). It never leaves
//!   that store in plaintext except into memory here, to feed the SSH
//!   transport (`core::remote_ssh_transport`).
//! - On desktop this module is unused - desktop identifies with local
//!   `~/.ssh` keys instead (see `remote_local_keys`). `tauri-plugin-keystore`
//!   does ship a desktop fallback via the OS keyring, but it is not
//!   production-ready upstream (hardcoded identity, `unwrap()` on every
//!   error) - see its `src/desktop.rs`. Do not add a `#[cfg(not(mobile))]`
//!   path here without first checking whether that has changed upstream.

use russh::keys::ssh_key::private::{Ed25519Keypair, KeypairData};
use russh::keys::ssh_key::{HashAlg, PrivateKey};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DeviceKeyInfo {
  pub public_key: String,
  pub fingerprint_sha256: String,
}

#[cfg_attr(not(any(mobile, test)), allow(dead_code))]
fn generate_private_key() -> Result<PrivateKey, String> {
  let mut seed = [0u8; 32];
  getrandom::fill(&mut seed).map_err(|e| format!("failed to source randomness: {e}"))?;
  let keypair = Ed25519Keypair::from_seed(&seed);
  PrivateKey::new(KeypairData::Ed25519(keypair), "treq-mobile-device")
    .map_err(|e| format!("failed to generate device key: {e}"))
}

#[cfg_attr(not(any(mobile, test)), allow(dead_code))]
fn device_key_info(key: &PrivateKey) -> Result<DeviceKeyInfo, String> {
  let public_key = key.public_key();
  let public_key_line = public_key
    .to_openssh()
    .map_err(|e| format!("failed to encode device public key: {e}"))?;
  let fingerprint_sha256 = public_key.fingerprint(HashAlg::Sha256).to_string();
  Ok(DeviceKeyInfo {
    public_key: public_key_line,
    fingerprint_sha256,
  })
}

#[cfg(mobile)]
mod mobile_storage {
  use super::{generate_private_key, PrivateKey};
  use tauri_plugin_biometric::BiometricExt;
  use tauri_plugin_keystore::{KeystoreExt, RetrieveRequest, StoreRequest};

  const KEYSTORE_SERVICE: &str = "com.treq.mobile-device-key";
  const KEYSTORE_USER: &str = "device-key";

  fn require_biometrics(app: &tauri::AppHandle) -> Result<(), String> {
    let status = app
      .biometric()
      .status()
      .map_err(|e| format!("failed to read biometric status: {e}"))?;
    if !status.is_available {
      return Err(status.error.unwrap_or_else(|| {
        "Biometrics are not set up on this device; the device key cannot be stored securely."
          .to_string()
      }));
    }
    Ok(())
  }

  pub fn load_or_create(app: &tauri::AppHandle) -> Result<PrivateKey, String> {
    require_biometrics(app)?;

    let existing = app
      .keystore()
      .retrieve(RetrieveRequest {
        service: KEYSTORE_SERVICE.to_string(),
        user: KEYSTORE_USER.to_string(),
      })
      .map_err(|e| format!("failed to read device key from keystore: {e}"))?;

    if let Some(openssh) = existing.value {
      return openssh
        .parse::<PrivateKey>()
        .map_err(|e| format!("failed to parse stored device key: {e}"));
    }

    let key = generate_private_key()?;
    let openssh = key
      .to_openssh(Default::default())
      .map_err(|e| format!("failed to encode device key: {e}"))?;
    app
      .keystore()
      .store(StoreRequest { value: openssh })
      .map_err(|e| format!("failed to store device key in keystore: {e}"))?;
    Ok(key)
  }
}

/// Loads the device's ed25519 keypair, generating and persisting one on
/// first use. Returns only the public key line and its fingerprint - the
/// private key never leaves this module (and, on mobile, the OS keystore).
///
/// Mobile-only: desktop identifies with local `~/.ssh` keys instead (see
/// `remote_local_keys::list_local_ssh_identities`), so this always errors
/// on desktop rather than shipping the upstream keystore plugin's
/// unfinished desktop fallback (see module docs).
#[cfg(mobile)]
pub fn ensure_device_key(app: &tauri::AppHandle) -> Result<DeviceKeyInfo, String> {
  let key = mobile_storage::load_or_create(app)?;
  device_key_info(&key)
}

#[cfg(not(mobile))]
pub fn ensure_device_key(_app: &tauri::AppHandle) -> Result<DeviceKeyInfo, String> {
  Err(
    "Device key storage is only available on mobile builds; desktop uses local SSH identities \
     instead (see list_local_ssh_identities)."
      .to_string(),
  )
}

#[cfg(test)]
mod tests {
  // Exercising `ensure_device_key` end to end requires a running mobile
  // keystore/biometric plugin, which is not available in a unit test
  // process - see the `app-qa`/device-build path for that coverage
  // instead. This module keeps the platform-independent key-material
  // helpers covered.
  use super::*;

  #[test]
  fn generates_a_valid_ed25519_key() {
    let key = generate_private_key().unwrap();
    let info = device_key_info(&key).unwrap();
    assert!(info.public_key.starts_with("ssh-ed25519 "));
  }
}
