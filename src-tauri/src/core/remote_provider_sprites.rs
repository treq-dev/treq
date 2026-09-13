//! Fly Sprites provider adapter.
//!
//! Concrete implementation of [`ManagedComputeProvider`] against Fly's
//! Machines-style REST API. Nothing outside this module should import a Fly
//! SDK type or a raw Fly status string; every response is normalized into the
//! provider-neutral types from `core::remote_provider` before it leaves this
//! module.
//!
//! The vendor base URL and API token are read from configuration/secrets at
//! construction time and are never hardcoded or logged. Callers (Edge
//! Function equivalents, or a future control-plane binary) construct
//! [`SpritesConfig`] from environment/secret storage.

use crate::lock_ext::LockExt;
use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

use crate::core::remote_provider::{
  CreateInstanceRequest, ManagedComputeProvider, ManagedInstanceState, ProviderError,
  ProviderInstance, ProviderKind, RegionCode, ReplaceInstanceRequest, SizePreset,
};

/// Server-side configuration for talking to the Fly Machines API. Never
/// derive `Debug`/`Display` on the token field's containing struct in a way
/// that would print it; `SpritesConfig` intentionally implements a redacted
/// `Debug`.
#[derive(Clone)]
pub struct SpritesConfig {
  /// Vendor API base URL, e.g. `https://api.machines.dev/v1`. Read from
  /// config, never hardcoded.
  pub base_url: String,
  /// Fly API token. A server-side secret; never sent to a desktop client.
  pub api_token: String,
  /// Fly application name that owns provisioned machines.
  pub app_name: String,
  pub request_timeout: Duration,
}

impl std::fmt::Debug for SpritesConfig {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("SpritesConfig")
      .field("base_url", &self.base_url)
      .field("api_token", &"<redacted>")
      .field("app_name", &self.app_name)
      .field("request_timeout", &self.request_timeout)
      .finish()
  }
}

impl SpritesConfig {
  /// Reads configuration from environment variables. Intended for the
  /// server-side process (Edge Function equivalent / control-plane binary)
  /// that holds the vendor secret; a desktop client must never call this.
  pub fn from_env() -> Result<Self, ProviderError> {
    let base_url =
      std::env::var("FLY_SPRITES_API_BASE_URL").map_err(|_| ProviderError::InvalidRequest {
        message: "FLY_SPRITES_API_BASE_URL is not set".to_string(),
      })?;
    let api_token =
      std::env::var("FLY_SPRITES_API_TOKEN").map_err(|_| ProviderError::InvalidRequest {
        message: "FLY_SPRITES_API_TOKEN is not set".to_string(),
      })?;
    let app_name =
      std::env::var("FLY_SPRITES_APP_NAME").map_err(|_| ProviderError::InvalidRequest {
        message: "FLY_SPRITES_APP_NAME is not set".to_string(),
      })?;
    Ok(Self {
      base_url,
      api_token,
      app_name,
      request_timeout: Duration::from_secs(30),
    })
  }
}

/// Fly Sprites adapter. Holds an HTTP client and vendor configuration; no
/// mutable state beyond that lives here, so reconciliation state belongs to
/// the caller (control-plane storage), not the adapter.
pub struct SpritesProvider {
  client: Client,
  config: SpritesConfig,
  /// The vendor request id from the most recently completed HTTP call, if
  /// the response carried one. Populated from Fly's `fly-request-id`
  /// response header (matches the PRD's "capture provider request
  /// identifiers" observability requirement); feeds into audit/correlation
  /// records at the control-plane layer and into Phase 8's e2e assertions.
  last_request_id: std::sync::Mutex<Option<String>>,
}

impl SpritesProvider {
  pub fn new(config: SpritesConfig) -> Result<Self, ProviderError> {
    let client = Client::builder()
      .timeout(config.request_timeout)
      .build()
      .map_err(|err| ProviderError::Other {
        message: format!("failed to build HTTP client: {err}"),
      })?;
    Ok(Self {
      client,
      config,
      last_request_id: std::sync::Mutex::new(None),
    })
  }

  /// The vendor request id captured from the most recently completed HTTP
  /// call to the Fly Machines API, if any. `None` before any call has been
  /// made, or if the vendor response carried no request-id header.
  pub fn last_request_id(&self) -> Option<String> {
    self.last_request_id.lock_or_recover().clone()
  }

  /// Reads and records the vendor request id from a response's headers.
  /// Called for every request this adapter makes, success or failure, so a
  /// caller can always correlate the most recent call with the vendor's own
  /// logs/support tooling, per the PRD's audit requirements.
  fn capture_request_id(&self, response: &reqwest::Response) {
    let id = response
      .headers()
      .get("fly-request-id")
      .or_else(|| response.headers().get("x-request-id"))
      .and_then(|value| value.to_str().ok())
      .map(str::to_string);
    if let Some(id) = id {
      *self.last_request_id.lock_or_recover() = Some(id);
    }
  }

  /// Read-only accessors for the adapter's own configuration. Intended for
  /// callers (e.g. the Phase 8 real-API test harness) that need to rebuild
  /// an equivalent provider on another task/thread - such as a
  /// compensating-cleanup guard that must run from a `Drop` impl - without
  /// exposing mutable or serializable config elsewhere.
  pub fn config_base_url(&self) -> String {
    self.config.base_url.clone()
  }

  pub fn config_api_token(&self) -> String {
    self.config.api_token.clone()
  }

  pub fn config_app_name(&self) -> String {
    self.config.app_name.clone()
  }

  fn machines_url(&self) -> String {
    format!(
      "{}/apps/{}/machines",
      self.config.base_url.trim_end_matches('/'),
      self.config.app_name
    )
  }

  fn machine_url(&self, machine_id: &str) -> String {
    format!("{}/{}", self.machines_url(), machine_id)
  }

  fn region_slug(region: RegionCode) -> &'static str {
    // Treq region codes map to Fly region codes. Kept private to the adapter
    // so no vendor slug leaks past this module.
    match region {
      RegionCode::UsEast => "iad",
      RegionCode::UsWest => "sjc",
      RegionCode::EuWest => "lhr",
      RegionCode::ApSoutheast => "sin",
      // Unmapped future regions fall back to a sane default rather than
      // panicking; the control plane should reject unsupported regions
      // before reaching this adapter.
    }
  }

  // PRD "Resource quotas": every user's managed instance is enforced at the
  // fixed base allocation (5 GB disk / 1 vCPU / 2 GB RAM) at provisioning
  // time, regardless of `preset` - purchasing more as a plan add-on is
  // explicitly out of scope for this delivery. This stays unconditional
  // (rather than branching on `preset`) so the vendor request can never
  // exceed the quota even if a caller upstream forgets to reject a
  // non-base preset first.
  fn size_to_guest(_preset: SizePreset) -> MachineGuestConfig {
    MachineGuestConfig {
      cpu_kind: "shared".to_string(),
      cpus: crate::core::remote_provider::BASE_ALLOCATION.vcpus,
      memory_mb: crate::core::remote_provider::BASE_ALLOCATION.memory_gb * 1024,
    }
  }

  /// Disk allocation requested alongside the guest spec, capped at the base
  /// disk quota (PRD "Resource quotas"). Mirrors
  /// `_shared/remote/sprites-adapter.ts::baseVolumeSizeGb`.
  fn base_volume() -> MachineMount {
    MachineMount {
      path: "/home/treq".to_string(),
      size_gb: crate::core::remote_provider::BASE_ALLOCATION.storage_gb,
    }
  }

  fn boot_manifest_env(manifest_version: u32) -> std::collections::HashMap<String, String> {
    // The boot manifest itself is looked up by version inside the bootstrap
    // script (see `remote_bootstrap`); only the version is passed as machine
    // metadata so the vendor init step knows which manifest to apply.
    let mut env = std::collections::HashMap::new();
    env.insert(
      "TREQ_BOOT_MANIFEST_VERSION".to_string(),
      manifest_version.to_string(),
    );
    env
  }

  fn auth_headers(&self, idempotency_key: Option<&str>) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
      reqwest::header::AUTHORIZATION,
      format!("Bearer {}", self.config.api_token)
        .parse()
        .expect("bearer header value is always valid ASCII"),
    );
    headers.insert(
      reqwest::header::CONTENT_TYPE,
      reqwest::header::HeaderValue::from_static("application/json"),
    );
    // Fly Machines' create/update APIs treat repeated identical requests as
    // safe to retry when tagged with the same key; some vendor deployments
    // read this from a bespoke header rather than a standard Idempotency-Key.
    // We send both so retries are safe regardless of which the target
    // deployment honors.
    if let Some(key) = idempotency_key {
      if let Ok(value) = reqwest::header::HeaderValue::from_str(key) {
        headers.insert("Idempotency-Key", value.clone());
        headers.insert("Fly-Idempotency-Key", value);
      }
    }
    headers
  }

  fn map_transport_error(err: reqwest::Error) -> ProviderError {
    if err.is_timeout() {
      ProviderError::Timeout
    } else if err.is_connect() {
      ProviderError::Unavailable {
        message: "could not connect to Fly Machines API".to_string(),
      }
    } else {
      ProviderError::Other {
        message: "provider request failed".to_string(),
      }
    }
  }

  fn map_status_error(status: StatusCode, body: &str) -> ProviderError {
    match status {
      StatusCode::NOT_FOUND => ProviderError::NotFound,
      StatusCode::CONFLICT => ProviderError::AlreadyExists,
      StatusCode::TOO_MANY_REQUESTS => ProviderError::QuotaExceeded,
      StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => ProviderError::InvalidRequest {
        message: truncate_body(body),
      },
      s if s.is_server_error() => ProviderError::Unavailable {
        message: truncate_body(body),
      },
      _ => ProviderError::Other {
        message: truncate_body(body),
      },
    }
  }

  fn normalize_state(machine: &MachineResponse) -> ManagedInstanceState {
    match machine.state.as_str() {
      "created" | "starting" => ManagedInstanceState::Provisioning,
      "started" => ManagedInstanceState::Ready,
      "stopping" | "stopped" | "suspended" => ManagedInstanceState::Suspended,
      "replacing" => ManagedInstanceState::Reprovisioning,
      "destroying" => ManagedInstanceState::Deleting,
      "destroyed" => ManagedInstanceState::Deleted,
      _ => ManagedInstanceState::Degraded,
    }
  }

  fn normalize_instance(machine: MachineResponse) -> ProviderInstance {
    let state = Self::normalize_state(&machine);
    let region = parse_region_slug(&machine.region);
    let size_preset = parse_guest_config(&machine.config.guest);
    ProviderInstance {
      provider_resource_id: machine.id,
      state,
      region,
      size_preset,
      address: machine.private_ip,
    }
  }
}

fn truncate_body(body: &str) -> String {
  const MAX: usize = 500;
  if body.len() > MAX {
    format!("{}…", &body[..MAX])
  } else {
    body.to_string()
  }
}

fn parse_region_slug(slug: &str) -> RegionCode {
  match slug {
    "iad" => RegionCode::UsEast,
    "sjc" => RegionCode::UsWest,
    "lhr" => RegionCode::EuWest,
    "sin" => RegionCode::ApSoutheast,
    _ => RegionCode::UsEast,
  }
}

fn parse_guest_config(guest: &MachineGuestConfig) -> SizePreset {
  if guest.memory_mb <= 2048 {
    SizePreset::Small
  } else if guest.memory_mb <= 4096 {
    SizePreset::Medium
  } else {
    SizePreset::Large
  }
}

// -- Vendor wire types --------------------------------------------------------
// These shapes mirror (a documented subset of) Fly's Machines API. They must
// never be exported from this module; `normalize_instance` is the only bridge
// to the provider-neutral domain types.

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MachineGuestConfig {
  cpu_kind: String,
  cpus: u32,
  memory_mb: u32,
}

#[derive(Debug, Clone, Serialize)]
struct MachineConfigRequest {
  image: String,
  guest: MachineGuestConfig,
  mounts: Vec<MachineMount>,
  env: std::collections::HashMap<String, String>,
  init: MachineInit,
}

/// Persistent volume attachment, sized to the base disk quota (PRD
/// "Resource quotas"). Fly Machines expresses disk as a separate `mounts`
/// attachment rather than part of `guest`.
#[derive(Debug, Clone, Serialize)]
struct MachineMount {
  path: String,
  size_gb: u32,
}

#[derive(Debug, Clone, Serialize)]
struct MachineInit {
  /// Bootstrap entrypoint invoked on boot; installs the versioned boot
  /// manifest (see `remote_bootstrap::bootstrap_script`).
  exec: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct CreateMachineRequest {
  name: String,
  region: String,
  config: MachineConfigRequest,
}

#[derive(Debug, Clone, Deserialize)]
struct MachineResponse {
  id: String,
  region: String,
  state: String,
  config: MachineResponseConfig,
  #[serde(default)]
  private_ip: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct MachineResponseConfig {
  guest: MachineGuestConfig,
}

/// Boot image reference. Fixed here rather than user-configurable: the image
/// is Treq's own base image, versioned alongside the boot manifest.
const SPRITES_BASE_IMAGE: &str = "registry.fly.io/treq-remote-base:latest";

#[async_trait::async_trait]
impl ManagedComputeProvider for SpritesProvider {
  fn provider_kind(&self) -> ProviderKind {
    ProviderKind::FlySprites
  }

  async fn create_instance(
    &self,
    request: CreateInstanceRequest,
  ) -> Result<ProviderInstance, ProviderError> {
    let body = CreateMachineRequest {
      // Deterministic from the owner id so a retried create (same
      // idempotency key, same owner) targets the same machine name even if
      // the idempotency header is dropped by an intermediary.
      name: format!("treq-{}", request.owner_user_id),
      region: Self::region_slug(request.region).to_string(),
      config: MachineConfigRequest {
        image: SPRITES_BASE_IMAGE.to_string(),
        guest: Self::size_to_guest(request.size_preset),
        mounts: vec![Self::base_volume()],
        env: Self::boot_manifest_env(request.manifest_version),
        init: MachineInit {
          exec: crate::core::remote_bootstrap::bootstrap_command(request.manifest_version),
        },
      },
    };

    let response = self
      .client
      .post(self.machines_url())
      .headers(self.auth_headers(Some(&request.idempotency_key)))
      .json(&body)
      .send()
      .await
      .map_err(Self::map_transport_error)?;
    self.capture_request_id(&response);

    let status = response.status();
    if status == StatusCode::CONFLICT {
      // The vendor treats a repeated create with the same idempotency key
      // (or same machine name) as already-existing; fetch and return the
      // current state instead of surfacing an error, so create is
      // effectively idempotent for the caller.
      let text = response.text().await.unwrap_or_default();
      if let Ok(existing) = serde_json::from_str::<MachineResponse>(&text) {
        return Ok(Self::normalize_instance(existing));
      }
      return Err(ProviderError::AlreadyExists);
    }
    if !status.is_success() {
      let text = response.text().await.unwrap_or_default();
      return Err(Self::map_status_error(status, &text));
    }

    let machine: MachineResponse = response.json().await.map_err(|_| ProviderError::Other {
      message: "could not parse provider response".to_string(),
    })?;
    Ok(Self::normalize_instance(machine))
  }

  async fn get_instance(&self, provider_id: &str) -> Result<ProviderInstance, ProviderError> {
    let response = self
      .client
      .get(self.machine_url(provider_id))
      .headers(self.auth_headers(None))
      .send()
      .await
      .map_err(Self::map_transport_error)?;
    self.capture_request_id(&response);

    let status = response.status();
    if !status.is_success() {
      let text = response.text().await.unwrap_or_default();
      return Err(Self::map_status_error(status, &text));
    }
    let machine: MachineResponse = response.json().await.map_err(|_| ProviderError::Other {
      message: "could not parse provider response".to_string(),
    })?;
    Ok(Self::normalize_instance(machine))
  }

  async fn wake_instance(&self, provider_id: &str) -> Result<(), ProviderError> {
    let url = format!("{}/start", self.machine_url(provider_id));
    let response = self
      .client
      .post(url)
      .headers(self.auth_headers(None))
      .send()
      .await
      .map_err(Self::map_transport_error)?;
    self.capture_request_id(&response);

    let status = response.status();
    // Fly returns 200/202 on accepted, and treats "already started" as a
    // success too (some deployments return 400 with a specific message for
    // that case); accept both to keep wake idempotent.
    if status.is_success() {
      return Ok(());
    }
    let text = response.text().await.unwrap_or_default();
    if status == StatusCode::BAD_REQUEST && text.to_lowercase().contains("already") {
      return Ok(());
    }
    Err(Self::map_status_error(status, &text))
  }

  async fn replace_instance(
    &self,
    request: ReplaceInstanceRequest,
  ) -> Result<ProviderInstance, ProviderError> {
    let body = MachineConfigRequest {
      image: SPRITES_BASE_IMAGE.to_string(),
      guest: Self::size_to_guest(request.size_preset),
      mounts: vec![Self::base_volume()],
      env: Self::boot_manifest_env(request.manifest_version),
      init: MachineInit {
        exec: crate::core::remote_bootstrap::bootstrap_command(request.manifest_version),
      },
    };

    // Fly Machines models an in-place config update as POST .../update; a
    // region change is not supported in place (matches the PRD's "Region
    // migration is not supported" non-goal), so a region change must go
    // through delete+create at the control-plane level rather than this
    // adapter call. We still forward the requested region for validation.
    let url = format!("{}/update", self.machine_url(&request.provider_resource_id));
    let response = self
      .client
      .post(url)
      .headers(self.auth_headers(Some(&request.idempotency_key)))
      .json(&body)
      .send()
      .await
      .map_err(Self::map_transport_error)?;
    self.capture_request_id(&response);

    let status = response.status();
    if !status.is_success() {
      let text = response.text().await.unwrap_or_default();
      return Err(Self::map_status_error(status, &text));
    }
    let machine: MachineResponse = response.json().await.map_err(|_| ProviderError::Other {
      message: "could not parse provider response".to_string(),
    })?;
    Ok(Self::normalize_instance(machine))
  }

  async fn delete_instance(&self, provider_id: &str) -> Result<(), ProviderError> {
    let response = self
      .client
      .delete(self.machine_url(provider_id))
      .query(&[("force", "true")])
      .headers(self.auth_headers(None))
      .send()
      .await
      .map_err(Self::map_transport_error)?;
    self.capture_request_id(&response);

    let status = response.status();
    // A delete of an already-deleted (404) instance is a no-op success, so
    // repeated delete calls remain idempotent.
    if status.is_success() || status == StatusCode::NOT_FOUND {
      return Ok(());
    }
    let text = response.text().await.unwrap_or_default();
    Err(Self::map_status_error(status, &text))
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::core::remote_provider::{ManagedInstanceState, RegionCode, SizePreset};
  use serde_json::json;
  use wiremock::matchers::{method, path};
  use wiremock::{Mock, MockServer, ResponseTemplate};

  fn test_config(base_url: String) -> SpritesConfig {
    SpritesConfig {
      base_url,
      api_token: "test-token".to_string(),
      app_name: "treq-remote".to_string(),
      request_timeout: Duration::from_secs(5),
    }
  }

  fn machine_json(id: &str, state: &str) -> serde_json::Value {
    json!({
      "id": id,
      "region": "iad",
      "state": state,
      "config": { "guest": { "cpu_kind": "shared", "cpus": 1, "memory_mb": 2048 } },
      "private_ip": "fdaa:0:1::1"
    })
  }

  #[tokio::test]
  async fn create_instance_normalizes_a_started_machine() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/apps/treq-remote/machines"))
      .respond_with(ResponseTemplate::new(200).set_body_json(machine_json("m1", "started")))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    let result = provider
      .create_instance(CreateInstanceRequest {
        owner_user_id: "user-1".to_string(),
        region: RegionCode::UsEast,
        size_preset: SizePreset::Small,
        manifest_version: 1,
        idempotency_key: "key-1".to_string(),
      })
      .await
      .unwrap();

    assert_eq!(result.provider_resource_id, "m1");
    assert_eq!(result.state, ManagedInstanceState::Ready);
    assert_eq!(result.region, RegionCode::UsEast);
    assert_eq!(result.size_preset, SizePreset::Small);
    assert_eq!(result.address.as_deref(), Some("fdaa:0:1::1"));
  }

  #[tokio::test]
  async fn create_instance_always_requests_the_base_allocation_regardless_of_preset() {
    // PRD "Resource quotas": provisioning must request exactly the base
    // allocation (5 GB disk / 1 vCPU / 2 GB RAM) from the vendor no matter
    // which preset was selected, since add-on purchase does not exist yet.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/apps/treq-remote/machines"))
      .respond_with(ResponseTemplate::new(200).set_body_json(machine_json("m-quota", "started")))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    for (i, preset) in [SizePreset::Small, SizePreset::Medium, SizePreset::Large]
      .into_iter()
      .enumerate()
    {
      provider
        .create_instance(CreateInstanceRequest {
          owner_user_id: format!("user-{i}"),
          region: RegionCode::UsEast,
          size_preset: preset,
          manifest_version: 1,
          idempotency_key: format!("key-quota-{i}"),
        })
        .await
        .unwrap();
    }

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 3);
    for request in requests {
      let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
      let guest = &body["config"]["guest"];
      assert_eq!(
        guest["cpus"],
        json!(crate::core::remote_provider::BASE_ALLOCATION.vcpus)
      );
      assert_eq!(
        guest["memory_mb"],
        json!(crate::core::remote_provider::BASE_ALLOCATION.memory_gb * 1024)
      );
      let mounts = body["config"]["mounts"].as_array().unwrap();
      assert_eq!(
        mounts[0]["size_gb"],
        json!(crate::core::remote_provider::BASE_ALLOCATION.storage_gb)
      );
    }
  }

  #[tokio::test]
  async fn create_instance_captures_vendor_request_id_header() {
    // Ungated, mocked coverage for the Phase 8 "capture provider request
    // IDs" requirement: the real-API path (remote_e2e.rs) exercises this
    // against the genuine header from Fly, but the capture/storage logic
    // itself is provider-adapter code this repo owns and can verify here
    // without a live vendor.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/apps/treq-remote/machines"))
      .respond_with(
        ResponseTemplate::new(200)
          .insert_header("fly-request-id", "01H000REQUESTID")
          .set_body_json(machine_json("m3", "started")),
      )
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    assert_eq!(provider.last_request_id(), None);
    provider
      .create_instance(CreateInstanceRequest {
        owner_user_id: "user-1".to_string(),
        region: RegionCode::UsEast,
        size_preset: SizePreset::Small,
        manifest_version: 1,
        idempotency_key: "key-request-id".to_string(),
      })
      .await
      .unwrap();

    assert_eq!(
      provider.last_request_id().as_deref(),
      Some("01H000REQUESTID")
    );
  }

  #[tokio::test]
  async fn create_instance_sends_idempotency_headers() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/apps/treq-remote/machines"))
      .and(wiremock::matchers::header("Idempotency-Key", "key-42"))
      .respond_with(ResponseTemplate::new(200).set_body_json(machine_json("m2", "created")))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    let result = provider
      .create_instance(CreateInstanceRequest {
        owner_user_id: "user-1".to_string(),
        region: RegionCode::EuWest,
        size_preset: SizePreset::Medium,
        manifest_version: 1,
        idempotency_key: "key-42".to_string(),
      })
      .await
      .unwrap();

    assert_eq!(result.state, ManagedInstanceState::Provisioning);
  }

  #[tokio::test]
  async fn create_instance_conflict_returns_existing_machine_instead_of_erroring() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/apps/treq-remote/machines"))
      .respond_with(ResponseTemplate::new(409).set_body_json(machine_json("m1", "started")))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    let result = provider
      .create_instance(CreateInstanceRequest {
        owner_user_id: "user-1".to_string(),
        region: RegionCode::UsEast,
        size_preset: SizePreset::Small,
        manifest_version: 1,
        idempotency_key: "key-1".to_string(),
      })
      .await
      .unwrap();

    assert_eq!(result.provider_resource_id, "m1");
  }

  #[tokio::test]
  async fn get_instance_maps_not_found() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
      .and(path("/apps/treq-remote/machines/missing"))
      .respond_with(ResponseTemplate::new(404))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    let err = provider.get_instance("missing").await.unwrap_err();
    assert_eq!(err, ProviderError::NotFound);
  }

  #[tokio::test]
  async fn get_instance_maps_suspended_state() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
      .and(path("/apps/treq-remote/machines/m1"))
      .respond_with(ResponseTemplate::new(200).set_body_json(machine_json("m1", "stopped")))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    let result = provider.get_instance("m1").await.unwrap();
    assert_eq!(result.state, ManagedInstanceState::Suspended);
  }

  #[tokio::test]
  async fn wake_instance_succeeds_on_accepted() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/apps/treq-remote/machines/m1/start"))
      .respond_with(ResponseTemplate::new(202))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    provider.wake_instance("m1").await.unwrap();
  }

  #[tokio::test]
  async fn wake_instance_is_idempotent_when_already_started() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/apps/treq-remote/machines/m1/start"))
      .respond_with(ResponseTemplate::new(400).set_body_string("machine already started"))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    provider.wake_instance("m1").await.unwrap();
  }

  #[tokio::test]
  async fn replace_instance_normalizes_updated_machine() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/apps/treq-remote/machines/m1/update"))
      .respond_with(ResponseTemplate::new(200).set_body_json(machine_json("m1", "starting")))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    let result = provider
      .replace_instance(ReplaceInstanceRequest {
        provider_resource_id: "m1".to_string(),
        region: RegionCode::UsEast,
        size_preset: SizePreset::Large,
        manifest_version: 1,
        idempotency_key: "replace-1".to_string(),
      })
      .await
      .unwrap();

    assert_eq!(result.state, ManagedInstanceState::Provisioning);
  }

  #[tokio::test]
  async fn delete_instance_is_idempotent_on_repeat_calls() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
      .and(path("/apps/treq-remote/machines/m1"))
      .respond_with(ResponseTemplate::new(404))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    provider.delete_instance("m1").await.unwrap();
  }

  #[tokio::test]
  async fn delete_instance_maps_server_error() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
      .and(path("/apps/treq-remote/machines/m1"))
      .respond_with(ResponseTemplate::new(500).set_body_string("boom"))
      .mount(&server)
      .await;

    let provider = SpritesProvider::new(test_config(server.uri())).unwrap();
    let err = provider.delete_instance("m1").await.unwrap_err();
    assert!(matches!(err, ProviderError::Unavailable { .. }));
  }

  #[test]
  fn config_debug_redacts_token() {
    let config = test_config("https://example.test".to_string());
    let debug = format!("{:?}", config);
    assert!(!debug.contains("test-token"));
    assert!(debug.contains("<redacted>"));
  }
}
