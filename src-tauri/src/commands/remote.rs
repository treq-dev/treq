use crate::core::feature_preview::PreviewFeature;
use crate::core::remote::{self, SshHost};
use crate::core::remote_control_plane::SshEndpoint;
use crate::core::remote_device_key::{self, DeviceKeyInfo};
use crate::core::remote_local_keys::{self, LocalSshIdentity};
use crate::core::remote_ssh_config::{self, ResolvedSshAlias};
use crate::AppState;
use tauri::State;

fn require_remote_ssh(state: &State<AppState>) -> Result<(), String> {
  crate::commands::feature_preview::require(state, PreviewFeature::RemoteSsh)
}

#[tauri::command]
pub fn list_ssh_hosts(state: State<AppState>) -> Result<Vec<SshHost>, String> {
  require_remote_ssh(&state)?;
  remote::list_configured_hosts()
}

/// Resolves an explicitly-selected `~/.ssh/config` alias into its hostname,
/// port, username, and identity fields (PRD "Treat discovery as autocomplete
/// only; never connect merely because an alias was found"). This performs no
/// network I/O and never grants trust by itself — the UI uses it only to
/// prefill the registration form; the user still supplies and confirms the
/// expected host-key fingerprint before [`build_explicit_alias_ssh_endpoint`]
/// ever runs.
#[tauri::command]
pub fn resolve_ssh_config_alias(
  state: State<AppState>,
  alias: String,
) -> Result<ResolvedSshAlias, String> {
  require_remote_ssh(&state)?;
  remote_ssh_config::resolve_alias(&alias).map_err(|error| error.to_string())
}

/// Builds a fully-explicit, trust-pinned native [`SshEndpoint`] for an
/// explicitly-selected alias, after the user has supplied the expected
/// host-key fingerprint (PRD "Require explicit endpoint registration and the
/// user-supplied expected fingerprint" / "Construct an explicit native
/// SshEndpoint after registration"). The returned endpoint is only ever
/// connected to through the native `russh`-based transport
/// (`remote_dispatch_over_ssh` / `remote_dispatch_mutation_over_ssh`), whose
/// `HostKeyVerifier` enforces exactly the fingerprint supplied here — never a
/// system `ssh` subprocess, `known_hosts`, or `StrictHostKeyChecking=no`.
/// A `ProxyJump`/`ProxyCommand` directive on the alias is rejected here with
/// a structured `unsupported_ssh_config_feature` error rather than silently
/// dropped.
#[tauri::command]
pub fn build_explicit_alias_ssh_endpoint(
  state: State<AppState>,
  endpoint_id: String,
  alias: String,
  expected_fingerprint: String,
  host_key_algorithm: String,
  username_override: Option<String>,
  key_reference: String,
) -> Result<SshEndpoint, String> {
  require_remote_ssh(&state)?;
  remote_ssh_config::build_explicit_alias_endpoint(
    endpoint_id,
    &alias,
    &remote_ssh_config::default_ssh_config_paths(),
    expected_fingerprint,
    host_key_algorithm,
    username_override,
    key_reference,
  )
  .map_err(|error| error.to_string())
}

/// Lists the user's existing local SSH public-key identities, for the
/// managed-VM setup flow's identity picker. Never reads or returns private
/// key material - see `core::remote_local_keys`.
#[tauri::command]
pub fn list_local_ssh_identities(state: State<AppState>) -> Result<Vec<LocalSshIdentity>, String> {
  require_remote_ssh(&state)?;
  remote_local_keys::list_local_ssh_identities()
}

/// Reads the raw OpenSSH public-key text for a `list_local_ssh_identities`
/// reference, so the managed-VM setup flow can register it with the
/// control plane. Never reads or returns private key material - see
/// `core::remote_local_keys::read_local_public_key`.
#[tauri::command]
pub fn read_local_ssh_public_key(
  state: State<AppState>,
  reference: String,
) -> Result<String, String> {
  require_remote_ssh(&state)?;
  remote_local_keys::read_local_public_key(&reference)
}

/// Ensures this device has an ed25519 keypair for control-plane
/// registration and certificate-based SSH auth, generating one on first
/// use. Returns only public material - see `core::remote_device_key`.
#[tauri::command]
pub fn ensure_mobile_device_key(
  state: State<AppState>,
  app: tauri::AppHandle,
) -> Result<DeviceKeyInfo, String> {
  require_remote_ssh(&state)?;
  remote_device_key::ensure_device_key(&app)
}
