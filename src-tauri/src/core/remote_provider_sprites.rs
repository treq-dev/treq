//! Provider adapter for the public Fly Sprites API.

use crate::core::remote_provider::{
  CreateInstanceRequest, ManagedComputeProvider, ManagedInstanceState, ProviderError,
  ProviderInstance, ProviderKind, RegionCode, ReplaceInstanceRequest, SizePreset,
};
use crate::lock_ext::LockExt;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone)]
pub struct SpritesConfig {
  pub base_url: String,
  pub api_token: String,
  /// Retained while the gated legacy e2e harness is migrated. The Sprites
  /// API does not use Fly app names.
  pub app_name: String,
  pub request_timeout: Duration,
}

impl std::fmt::Debug for SpritesConfig {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("SpritesConfig")
      .field("base_url", &self.base_url)
      .field("api_token", &"<redacted>")
      .field("request_timeout", &self.request_timeout)
      .finish()
  }
}

impl SpritesConfig {
  pub fn from_env() -> Result<Self, ProviderError> {
    let base_url = std::env::var("SPRITES_API_URL")
      .or_else(|_| std::env::var("FLY_SPRITES_API_BASE_URL"))
      .map_err(|_| ProviderError::InvalidRequest {
        message: "SPRITES_API_URL is not set".to_string(),
      })?;
    let api_token = std::env::var("SPRITES_API_TOKEN")
      .or_else(|_| std::env::var("FLY_SPRITES_API_TOKEN"))
      .map_err(|_| ProviderError::InvalidRequest {
        message: "SPRITES_API_TOKEN is not set".to_string(),
      })?;
    Ok(Self {
      base_url,
      api_token,
      app_name: String::new(),
      request_timeout: Duration::from_secs(30),
    })
  }
}

pub struct SpritesProvider {
  client: Client,
  config: SpritesConfig,
  last_request_id: std::sync::Mutex<Option<String>>,
}

#[derive(Serialize)]
struct CreateSpriteRequest {
  name: String,
}

#[derive(Deserialize)]
struct SpriteResponse {
  name: String,
  status: String,
}

impl SpritesProvider {
  pub fn new(config: SpritesConfig) -> Result<Self, ProviderError> {
    let client = Client::builder()
      .timeout(config.request_timeout)
      .build()
      .map_err(|error| ProviderError::Other {
        message: format!("failed to build provider client: {error}"),
      })?;
    Ok(Self {
      client,
      config,
      last_request_id: std::sync::Mutex::new(None),
    })
  }

  pub fn last_request_id(&self) -> Option<String> {
    self.last_request_id.lock_or_recover().clone()
  }
  pub fn config_base_url(&self) -> String {
    self.config.base_url.clone()
  }
  pub fn config_api_token(&self) -> String {
    self.config.api_token.clone()
  }
  pub fn config_app_name(&self) -> String {
    self.config.app_name.clone()
  }

  fn sprites_url(&self) -> String {
    format!("{}/v1/sprites", self.config.base_url.trim_end_matches('/'))
  }
  fn sprite_url(&self, name: &str) -> String {
    format!("{}/{}", self.sprites_url(), urlencoding::encode(name))
  }
  fn auth(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    request.bearer_auth(&self.config.api_token)
  }
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
  fn deterministic_name(owner: &str) -> String {
    let normalized: String = owner
      .to_ascii_lowercase()
      .chars()
      .map(|c| {
        if c.is_ascii_alphanumeric() || c == '-' {
          c
        } else {
          '-'
        }
      })
      .collect();
    format!("treq-{normalized}").chars().take(63).collect()
  }
  fn normalize(sprite: SpriteResponse) -> ProviderInstance {
    let state = match sprite.status.as_str() {
      "creating" => ManagedInstanceState::Provisioning,
      "running" => ManagedInstanceState::Ready,
      "cold" | "paused" => ManagedInstanceState::Suspended,
      _ => ManagedInstanceState::Degraded,
    };
    ProviderInstance {
      provider_resource_id: sprite.name,
      state,
      // Compatibility defaults until these legacy columns become nullable.
      region: RegionCode::UsEast,
      size_preset: SizePreset::Small,
      address: None,
    }
  }
  fn transport_error(error: reqwest::Error) -> ProviderError {
    if error.is_timeout() {
      ProviderError::Timeout
    } else {
      ProviderError::Unavailable {
        message: "could not reach Sprites API".to_string(),
      }
    }
  }
  fn status_error(status: StatusCode, body: &str) -> ProviderError {
    let message: String = body.chars().take(500).collect();
    match status {
      StatusCode::NOT_FOUND => ProviderError::NotFound,
      StatusCode::CONFLICT => ProviderError::AlreadyExists,
      StatusCode::TOO_MANY_REQUESTS => ProviderError::QuotaExceeded,
      StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY | StatusCode::UNAUTHORIZED => {
        ProviderError::InvalidRequest { message }
      }
      status if status.is_server_error() => ProviderError::Unavailable { message },
      _ => ProviderError::Other { message },
    }
  }
  async fn parse(&self, response: reqwest::Response) -> Result<ProviderInstance, ProviderError> {
    let status = response.status();
    if !status.is_success() {
      let body = response.text().await.unwrap_or_default();
      return Err(Self::status_error(status, &body));
    }
    response
      .json::<SpriteResponse>()
      .await
      .map(Self::normalize)
      .map_err(|_| ProviderError::Other {
        message: "could not parse provider response".to_string(),
      })
  }
}

#[async_trait::async_trait]
impl ManagedComputeProvider for SpritesProvider {
  fn provider_kind(&self) -> ProviderKind {
    ProviderKind::FlySprites
  }
  async fn create_instance(
    &self,
    request: CreateInstanceRequest,
  ) -> Result<ProviderInstance, ProviderError> {
    let name = Self::deterministic_name(&request.owner_user_id);
    let response = self
      .auth(self.client.post(self.sprites_url()))
      .json(&CreateSpriteRequest { name: name.clone() })
      .send()
      .await
      .map_err(Self::transport_error)?;
    self.capture_request_id(&response);
    if response.status() == StatusCode::CONFLICT {
      return self.get_instance(&name).await;
    }
    self.parse(response).await
  }
  async fn get_instance(&self, provider_id: &str) -> Result<ProviderInstance, ProviderError> {
    let response = self
      .auth(self.client.get(self.sprite_url(provider_id)))
      .send()
      .await
      .map_err(Self::transport_error)?;
    self.capture_request_id(&response);
    self.parse(response).await
  }
  async fn wake_instance(&self, provider_id: &str) -> Result<(), ProviderError> {
    self.get_instance(provider_id).await.map(|_| ())
  }
  async fn replace_instance(
    &self,
    request: ReplaceInstanceRequest,
  ) -> Result<ProviderInstance, ProviderError> {
    // A Sprite's filesystem is the user's durable development environment.
    // Repair/rebootstrap must never replace it; only explicit deletion may
    // call the vendor DELETE endpoint.
    self.get_instance(&request.provider_resource_id).await
  }
  async fn delete_instance(&self, provider_id: &str) -> Result<(), ProviderError> {
    let response = self
      .auth(self.client.delete(self.sprite_url(provider_id)))
      .send()
      .await
      .map_err(Self::transport_error)?;
    self.capture_request_id(&response);
    let status = response.status();
    if status.is_success() || status == StatusCode::NOT_FOUND {
      return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    Err(Self::status_error(status, &body))
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;
  use wiremock::matchers::{body_json, method, path};
  use wiremock::{Mock, MockServer, ResponseTemplate};

  fn config(url: String) -> SpritesConfig {
    SpritesConfig {
      base_url: url,
      api_token: "secret-token".into(),
      app_name: String::new(),
      request_timeout: Duration::from_secs(5),
    }
  }
  fn request() -> CreateInstanceRequest {
    CreateInstanceRequest {
      owner_user_id: "User_1".into(),
      region: RegionCode::UsWest,
      size_preset: SizePreset::Large,
      manifest_version: 1,
      idempotency_key: "idem".into(),
    }
  }

  #[tokio::test]
  async fn creates_deterministic_sprite_without_machine_configuration() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(path("/v1/sprites"))
      .and(body_json(json!({"name": "treq-user-1"})))
      .respond_with(ResponseTemplate::new(201).set_body_json(json!({
        "name": "treq-user-1", "status": "running"
      })))
      .mount(&server)
      .await;
    let provider = SpritesProvider::new(config(server.uri())).unwrap();
    let instance = provider.create_instance(request()).await.unwrap();
    assert_eq!(instance.provider_resource_id, "treq-user-1");
    assert_eq!(instance.state, ManagedInstanceState::Ready);
    assert_eq!(instance.address, None);
  }

  #[tokio::test]
  async fn cold_sprite_maps_to_suspended() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
      .and(path("/v1/sprites/treq-user-1"))
      .respond_with(ResponseTemplate::new(200).set_body_json(json!({
        "name": "treq-user-1", "status": "cold"
      })))
      .mount(&server)
      .await;
    let provider = SpritesProvider::new(config(server.uri())).unwrap();
    assert_eq!(
      provider.get_instance("treq-user-1").await.unwrap().state,
      ManagedInstanceState::Suspended
    );
  }

  #[tokio::test]
  async fn delete_not_found_is_idempotent() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
      .and(path("/v1/sprites/missing"))
      .respond_with(ResponseTemplate::new(404))
      .mount(&server)
      .await;
    SpritesProvider::new(config(server.uri()))
      .unwrap()
      .delete_instance("missing")
      .await
      .unwrap();
  }

  #[tokio::test]
  async fn replace_preserves_the_existing_sprite() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
      .and(path("/v1/sprites/treq-user-1"))
      .respond_with(ResponseTemplate::new(200).set_body_json(json!({
        "name": "treq-user-1", "status": "running"
      })))
      .expect(1)
      .mount(&server)
      .await;
    let provider = SpritesProvider::new(config(server.uri())).unwrap();
    let instance = provider
      .replace_instance(ReplaceInstanceRequest {
        provider_resource_id: "treq-user-1".into(),
        region: RegionCode::UsEast,
        size_preset: SizePreset::Small,
        manifest_version: 2,
        idempotency_key: "repair".into(),
      })
      .await
      .unwrap();
    assert_eq!(instance.provider_resource_id, "treq-user-1");
  }

  #[test]
  fn config_debug_redacts_token() {
    let output = format!("{:?}", config("https://api.sprites.dev".into()));
    assert!(!output.contains("secret-token"));
    assert!(output.contains("<redacted>"));
  }
}
