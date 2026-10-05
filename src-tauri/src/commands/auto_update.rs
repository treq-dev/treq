use crate::core::auto_update::{self, UpdateCheckResult};
use crate::lock_ext::LockExt;
use crate::AppState;
use tauri::{AppHandle, State};

fn version_base_url_from_env() -> String {
  // Allow tests / local builds to override the marketing site origin.
  std::env::var("TREQ_WEB_URL")
    .unwrap_or_else(|_| auto_update::default_version_base_url().to_string())
}

fn auto_update_disabled_via_env() -> bool {
  std::env::var("TREQ_DISABLE_AUTO_UPDATE")
    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
    .unwrap_or(false)
}

#[tauri::command]
pub async fn check_for_app_update(state: State<'_, AppState>) -> Result<UpdateCheckResult, String> {
  let setting = state
    .db
    .lock_or_recover()
    .get_setting(auto_update::CHECK_FOR_UPDATES_SETTING_KEY)
    .ok()
    .flatten();
  let enabled =
    auto_update::update_checks_enabled(auto_update_disabled_via_env(), setting.as_deref());
  auto_update::check_for_update(
    enabled,
    auto_update::app_version(),
    &version_base_url_from_env(),
  )
  .await
}

#[tauri::command]
pub fn install_app_update(app: AppHandle, download_url: String) -> Result<(), String> {
  if !auto_update::update_install_supported() {
    return Err("Auto-update install is only supported on macOS".to_string());
  }
  if download_url.trim().is_empty() {
    return Err("Missing download URL".to_string());
  }
  // Only allow GitHub release assets for treq.
  if !download_url.starts_with("https://github.com/treq-dev/treq/releases/download/") {
    return Err("Download URL is not a trusted treq release asset".to_string());
  }
  auto_update::install_mac_update_from_url(&download_url)?;
  // Replace succeeded — relaunch into the new binary.
  app.restart();
}

#[cfg(test)]
mod tests {
  use super::auto_update_disabled_via_env;
  use crate::core::auto_update::parse_version_endpoint_body;

  #[test]
  fn auto_update_disabled_via_env_recognizes_flag() {
    let key = "TREQ_DISABLE_AUTO_UPDATE";
    let previous = std::env::var(key).ok();
    std::env::set_var(key, "1");
    assert!(auto_update_disabled_via_env());
    std::env::set_var(key, "true");
    assert!(auto_update_disabled_via_env());
    std::env::set_var(key, "0");
    assert!(!auto_update_disabled_via_env());
    match previous {
      Some(value) => std::env::set_var(key, value),
      None => std::env::remove_var(key),
    }
  }

  #[test]
  fn trusted_download_url_prefix_is_github_releases() {
    let ok = "https://github.com/treq-dev/treq/releases/download/v0.1.4/treq_aarch64.app.tar.gz";
    assert!(ok.starts_with("https://github.com/treq-dev/treq/releases/download/"));
    assert!(!ok.contains(".."));
  }

  #[test]
  fn version_body_matches_endpoint_contract() {
    assert_eq!(parse_version_endpoint_body("0.1.3\n").unwrap(), "0.1.3");
  }
}
