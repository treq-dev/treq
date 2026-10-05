//! Update checks against the marketing-site `/version` endpoint.
//! Every desktop build checks. Install in place is macOS only.

use std::cmp::Ordering;
use std::time::Duration;

const DEFAULT_VERSION_BASE_URL: &str = "https://treq.dev";
const GITHUB_RELEASES_BASE: &str = "https://github.com/treq-dev/treq/releases/download";

/// Production marketing-site origin used for `/version` checks.
pub fn default_version_base_url() -> &'static str {
  DEFAULT_VERSION_BASE_URL
}

/// App-level setting that turns update checks off when set to `"false"`.
pub const CHECK_FOR_UPDATES_SETTING_KEY: &str = "check_for_updates";

/// A stalled `/version` request should not leave a check hanging. The body is
/// a few bytes, so a healthy server answers well inside this.
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(5);

/// Result of checking whether a newer app version is published.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
  /// False when the check was skipped and no request was sent.
  pub checked: bool,
  /// True when this build can download and install the update in place.
  pub install_supported: bool,
  pub available: bool,
  pub current_version: String,
  pub latest_version: Option<String>,
  /// macOS updater archive. None when install in place is unsupported.
  pub download_url: Option<String>,
}

/// Parse a dotted numeric semver (`1.2.3` or `v1.2.3`) into (major, minor, patch).
/// Returns None if the string is not a plain X.Y.Z version.
pub fn parse_semver(version: &str) -> Option<(u64, u64, u64)> {
  let trimmed = version.trim().trim_start_matches('v');
  let mut parts = trimmed.split('.');
  let major = parts.next()?.parse().ok()?;
  let minor = parts.next()?.parse().ok()?;
  let patch = parts.next()?.parse().ok()?;
  if parts.next().is_some() {
    return None;
  }
  Some((major, minor, patch))
}

/// Compare two plain semver strings. Returns None if either side is unparseable.
pub fn compare_semver(a: &str, b: &str) -> Option<Ordering> {
  Some(parse_semver(a)?.cmp(&parse_semver(b)?))
}

/// True when `latest` is a strictly newer semver than `current`.
pub fn is_newer_version(current: &str, latest: &str) -> bool {
  matches!(compare_semver(latest, current), Some(Ordering::Greater))
}

/// URL of the static `/version` endpoint for a given site origin.
pub fn version_endpoint_url(base_url: &str) -> String {
  let base = base_url.trim_end_matches('/');
  format!("{base}/version")
}

/// Running app version (from the treq crate manifest).
pub fn app_version() -> &'static str {
  env!("CARGO_PKG_VERSION")
}

/// Map Rust/std arch names onto the GitHub release asset arch suffix.
/// Release assets use `aarch64` and `x64` (not `x86_64`).
pub fn release_arch_label(arch: &str) -> Option<&'static str> {
  match arch {
    "aarch64" => Some("aarch64"),
    "x86_64" => Some("x64"),
    _ => None,
  }
}

/// macOS updater artifact URL for a published version + arch.
pub fn mac_app_download_url(version: &str, arch: &str) -> Option<String> {
  let arch_label = release_arch_label(arch)?;
  let version = version.trim().trim_start_matches('v');
  Some(format!(
    "{GITHUB_RELEASES_BASE}/v{version}/treq_{arch_label}.app.tar.gz"
  ))
}

/// Build an update-check result from already-fetched version strings.
pub fn evaluate_update(
  current_version: &str,
  latest_version: &str,
  arch: &str,
  install_supported: bool,
) -> UpdateCheckResult {
  let current_version = current_version.trim().to_string();
  let latest = latest_version.trim();
  let available = is_newer_version(&current_version, latest);
  let download_url = if available && install_supported {
    mac_app_download_url(latest, arch)
  } else {
    None
  };

  UpdateCheckResult {
    checked: true,
    install_supported,
    available,
    current_version,
    latest_version: Some(latest.to_string()),
    download_url,
  }
}

/// Result for a check that was skipped, so no request went out.
pub fn skipped_update_result(current_version: &str, install_supported: bool) -> UpdateCheckResult {
  UpdateCheckResult {
    checked: false,
    install_supported,
    available: false,
    current_version: current_version.trim().to_string(),
    latest_version: None,
    download_url: None,
  }
}

/// Parse the plain-text body returned by `/version`.
pub fn parse_version_endpoint_body(body: &str) -> Result<String, String> {
  let version = body.trim();
  if version.is_empty() {
    return Err("Empty version response".to_string());
  }
  if parse_semver(version).is_none() {
    return Err(format!("Invalid version response: {version}"));
  }
  Ok(version.to_string())
}

/// Whether this build target checks `/version`. Every desktop build does.
pub fn update_check_supported() -> bool {
  cfg!(any(
    target_os = "macos",
    target_os = "windows",
    target_os = "linux"
  ))
}

/// Whether this build target can download and install an update in place.
/// Only macOS can: it swaps the `.app` bundle. Other platforms link to the
/// release page instead.
pub fn update_install_supported() -> bool {
  cfg!(target_os = "macos")
}

/// Whether to send the update check. The env var and the setting each turn it
/// off. A missing setting means on.
pub fn update_checks_enabled(disabled_via_env: bool, setting: Option<&str>) -> bool {
  !disabled_via_env && setting != Some("false")
}

/// Host arch string matching `std::env::consts::ARCH`.
pub fn host_arch() -> &'static str {
  std::env::consts::ARCH
}

/// User-Agent for the update check: `treq/<version> (<os>; <arch>)`. treq.dev
/// counts checks per day by this string, so it must stay free of anything
/// that identifies a user or an install.
pub fn update_check_user_agent(version: &str, os: &str, arch: &str) -> String {
  format!("treq/{version} ({os}; {arch})")
}

/// User-Agent for this build, from the crate version and `std::env::consts`.
pub fn host_user_agent() -> String {
  update_check_user_agent(app_version(), std::env::consts::OS, host_arch())
}

/// GET a URL and return its body. The request carries the given User-Agent and
/// nothing else that identifies the caller: no cookie store, no auth, and no
/// Referer on redirects.
pub async fn fetch_url_text(url: &str, user_agent: &str) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .user_agent(user_agent)
    .timeout(UPDATE_CHECK_TIMEOUT)
    .referer(false)
    .build()
    .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
  let response = client
    .get(url)
    .send()
    .await
    .and_then(reqwest::Response::error_for_status)
    .map_err(|e| format!("Failed to fetch {url}: {e}"))?;
  response
    .text()
    .await
    .map_err(|e| format!("Failed to read {url}: {e}"))
}

/// Download a URL to a local file path via curl.
pub fn download_url_to_file(url: &str, dest: &std::path::Path) -> Result<(), String> {
  let status = std::process::Command::new("curl")
    .args([
      "-fsSL",
      "--max-time",
      "300",
      "-o",
      &dest.to_string_lossy(),
      url,
    ])
    .status()
    .map_err(|e| format!("Failed to run curl: {e}"))?;
  if !status.success() {
    return Err(format!("Failed to download {url}"));
  }
  Ok(())
}

/// Check `/version` and compare against the running app version. When
/// `enabled` is false, `fetch` never runs.
pub async fn check_for_update_with_fetcher<F>(
  enabled: bool,
  current_version: &str,
  version_base_url: &str,
  arch: &str,
  install_supported: bool,
  fetch: F,
) -> Result<UpdateCheckResult, String>
where
  F: AsyncFnOnce(&str) -> Result<String, String>,
{
  if !enabled {
    return Ok(skipped_update_result(current_version, install_supported));
  }
  let endpoint = version_endpoint_url(version_base_url);
  let body = fetch(&endpoint).await?;
  let latest = parse_version_endpoint_body(&body)?;
  Ok(evaluate_update(
    current_version,
    &latest,
    arch,
    install_supported,
  ))
}

/// Production check against the live `/version` endpoint. Sends nothing when
/// `enabled` is false.
pub async fn check_for_update(
  enabled: bool,
  current_version: &str,
  version_base_url: &str,
) -> Result<UpdateCheckResult, String> {
  let enabled = enabled && update_check_supported();
  let user_agent = host_user_agent();
  check_for_update_with_fetcher(
    enabled,
    current_version,
    version_base_url,
    host_arch(),
    update_install_supported(),
    async |url: &str| fetch_url_text(url, &user_agent).await,
  )
  .await
}

/// Resolve the `.app` bundle that contains `exe_path`.
pub fn mac_app_bundle_from_exe(exe_path: &std::path::Path) -> Option<std::path::PathBuf> {
  for ancestor in exe_path.ancestors() {
    if ancestor
      .extension()
      .and_then(|ext| ext.to_str())
      .is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
    {
      return Some(ancestor.to_path_buf());
    }
  }
  None
}

/// Find the extracted `.app` directory under `dir` (non-recursive + one level).
pub fn find_extracted_app_bundle(dir: &std::path::Path) -> Result<std::path::PathBuf, String> {
  let mut apps = Vec::new();
  let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read extract dir: {e}"))?;
  for entry in entries {
    let entry = entry.map_err(|e| e.to_string())?;
    let path = entry.path();
    if path.extension().and_then(|e| e.to_str()) == Some("app") && path.is_dir() {
      apps.push(path);
    }
  }
  match apps.len() {
    1 => Ok(apps.remove(0)),
    0 => Err("No .app bundle found in update archive".to_string()),
    _ => Err("Multiple .app bundles found in update archive".to_string()),
  }
}

/// Download the macOS updater archive and replace the running app bundle.
///
/// On non-macOS targets this always returns an error — install is Mac-only.
pub fn install_mac_update_from_url(download_url: &str) -> Result<(), String> {
  install_mac_update_from_url_with(download_url, download_url_to_file, || {
    std::env::current_exe().map_err(|e| format!("Failed to resolve current executable: {e}"))
  })
}

/// Testable install path with injectable download + exe resolution.
pub fn install_mac_update_from_url_with<D, E>(
  download_url: &str,
  download: D,
  current_exe: E,
) -> Result<(), String>
where
  D: FnOnce(&str, &std::path::Path) -> Result<(), String>,
  E: FnOnce() -> Result<std::path::PathBuf, String>,
{
  if !update_install_supported() {
    return Err("Auto-update install is only supported on macOS".to_string());
  }

  let exe = current_exe()?;
  let current_app = mac_app_bundle_from_exe(&exe).ok_or_else(|| {
    "Could not locate the running .app bundle (dev builds are not updatable)".to_string()
  })?;

  let staging = std::env::temp_dir().join(format!("treq-update-{}", uuid::Uuid::new_v4()));
  std::fs::create_dir_all(&staging).map_err(|e| format!("Failed to create temp dir: {e}"))?;
  let cleanup_staging = staging.clone();
  let result = (|| {
    let archive_path = staging.join("treq-update.app.tar.gz");
    download(download_url, &archive_path)?;

    let extract_dir = staging.join("extract");
    std::fs::create_dir_all(&extract_dir)
      .map_err(|e| format!("Failed to create extract dir: {e}"))?;

    let status = std::process::Command::new("tar")
      .args([
        "-xzf",
        &archive_path.to_string_lossy(),
        "-C",
        &extract_dir.to_string_lossy(),
      ])
      .status()
      .map_err(|e| format!("Failed to run tar: {e}"))?;
    if !status.success() {
      return Err("Failed to extract update archive".to_string());
    }

    let new_app = find_extracted_app_bundle(&extract_dir)?;

    // Replace the running bundle in place. On macOS the running binary stays mapped
    // from the old inode; the next launch picks up the replaced files.
    let status = std::process::Command::new("ditto")
      .args([
        new_app.to_string_lossy().as_ref(),
        current_app.to_string_lossy().as_ref(),
      ])
      .status()
      .map_err(|e| format!("Failed to run ditto: {e}"))?;
    if !status.success() {
      return Err("Failed to replace the application bundle".to_string());
    }

    Ok(())
  })();
  let _ = std::fs::remove_dir_all(cleanup_staging);
  result
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parse_semver_accepts_plain_and_v_prefix() {
    assert_eq!(parse_semver("1.2.3"), Some((1, 2, 3)));
    assert_eq!(parse_semver("v0.1.3"), Some((0, 1, 3)));
    assert_eq!(parse_semver(" 0.1.3\n"), Some((0, 1, 3)));
  }

  #[test]
  fn parse_semver_rejects_invalid() {
    assert_eq!(parse_semver(""), None);
    assert_eq!(parse_semver("1.2"), None);
    assert_eq!(parse_semver("1.2.3.4"), None);
    assert_eq!(parse_semver("abc"), None);
  }

  #[test]
  fn is_newer_version_compares_semver() {
    assert!(is_newer_version("0.1.3", "0.1.4"));
    assert!(is_newer_version("0.1.3", "0.2.0"));
    assert!(is_newer_version("0.9.9", "1.0.0"));
    assert!(!is_newer_version("0.1.3", "0.1.3"));
    assert!(!is_newer_version("0.1.4", "0.1.3"));
  }

  #[test]
  fn version_endpoint_url_joins_base() {
    assert_eq!(
      version_endpoint_url("https://treq.dev"),
      "https://treq.dev/version"
    );
    assert_eq!(
      version_endpoint_url("https://treq.dev/"),
      "https://treq.dev/version"
    );
  }

  #[test]
  fn mac_app_download_url_uses_release_asset_naming() {
    assert_eq!(
      mac_app_download_url("0.1.4", "aarch64").as_deref(),
      Some("https://github.com/treq-dev/treq/releases/download/v0.1.4/treq_aarch64.app.tar.gz")
    );
    assert_eq!(
      mac_app_download_url("v0.1.4", "x86_64").as_deref(),
      Some("https://github.com/treq-dev/treq/releases/download/v0.1.4/treq_x64.app.tar.gz")
    );
    assert_eq!(mac_app_download_url("0.1.4", "arm"), None);
  }

  #[test]
  fn evaluate_update_unavailable_when_current() {
    let result = evaluate_update("0.1.3", "0.1.3", "aarch64", true);
    assert!(result.checked);
    assert!(result.install_supported);
    assert!(!result.available);
    assert!(result.download_url.is_none());
  }

  #[test]
  fn evaluate_update_available_on_supported_platform() {
    let result = evaluate_update("0.1.3", "0.1.4", "aarch64", true);
    assert!(result.install_supported);
    assert!(result.available);
    assert_eq!(result.latest_version.as_deref(), Some("0.1.4"));
    assert!(result
      .download_url
      .as_deref()
      .unwrap()
      .ends_with("treq_aarch64.app.tar.gz"));
  }

  #[test]
  fn evaluate_update_reports_available_without_install_url_when_install_unsupported() {
    let result = evaluate_update("0.1.3", "0.1.4", "x86_64", false);
    assert!(result.checked);
    assert!(!result.install_supported);
    assert!(result.available);
    assert_eq!(result.latest_version.as_deref(), Some("0.1.4"));
    assert!(result.download_url.is_none());
  }

  #[test]
  fn update_check_runs_on_every_desktop_platform_but_installs_only_on_macos() {
    assert!(update_check_supported());
    assert_eq!(update_install_supported(), cfg!(target_os = "macos"));
  }

  #[test]
  fn update_check_user_agent_names_version_os_and_arch() {
    assert_eq!(
      update_check_user_agent("0.3.0", "macos", "aarch64"),
      "treq/0.3.0 (macos; aarch64)"
    );
    assert_eq!(
      update_check_user_agent("0.3.0", "windows", "x86_64"),
      "treq/0.3.0 (windows; x86_64)"
    );
    assert_eq!(
      update_check_user_agent("0.3.0", "linux", "x86_64"),
      "treq/0.3.0 (linux; x86_64)"
    );
  }

  #[test]
  fn host_user_agent_uses_running_version_os_and_arch() {
    assert_eq!(
      host_user_agent(),
      format!(
        "treq/{} ({}; {})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
      )
    );
  }

  #[test]
  fn update_checks_enabled_defaults_on_and_honors_setting_and_env() {
    assert!(update_checks_enabled(false, None));
    assert!(update_checks_enabled(false, Some("true")));
    assert!(!update_checks_enabled(false, Some("false")));
    assert!(!update_checks_enabled(true, None));
    assert!(!update_checks_enabled(true, Some("true")));
  }

  #[test]
  fn parse_version_endpoint_body_trims_and_validates() {
    assert_eq!(parse_version_endpoint_body("0.1.3\n").unwrap(), "0.1.3");
    assert!(parse_version_endpoint_body("").is_err());
    assert!(parse_version_endpoint_body("nope").is_err());
  }

  #[tokio::test]
  async fn check_for_update_with_fetcher_reports_available() {
    let result = check_for_update_with_fetcher(
      true,
      "0.1.3",
      "https://treq.dev",
      "aarch64",
      true,
      async |_url: &str| Ok("0.1.4\n".to_string()),
    )
    .await
    .unwrap();
    assert!(result.available);
    assert_eq!(result.latest_version.as_deref(), Some("0.1.4"));
  }

  #[tokio::test]
  async fn check_for_update_with_fetcher_propagates_fetch_errors() {
    let err = check_for_update_with_fetcher(
      true,
      "0.1.3",
      "https://treq.dev",
      "aarch64",
      true,
      async |_url: &str| Err("network down".to_string()),
    )
    .await
    .unwrap_err();
    assert!(err.contains("network down"));
  }

  #[tokio::test]
  async fn check_for_update_with_fetcher_skips_fetch_when_disabled() {
    let result = check_for_update_with_fetcher(
      false,
      "0.1.3",
      "https://treq.dev",
      "aarch64",
      true,
      async |url: &str| -> Result<String, String> { panic!("disabled check fetched {url}") },
    )
    .await
    .unwrap();
    assert!(!result.checked);
    assert!(!result.available);
    assert_eq!(result.current_version, "0.1.3");
    assert!(result.latest_version.is_none());
  }

  #[tokio::test]
  async fn check_for_update_sends_only_the_user_agent() {
    use wiremock::{matchers::method, matchers::path, Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("GET"))
      .and(path("/version"))
      .respond_with(ResponseTemplate::new(200).set_body_string("99.0.0\n"))
      .mount(&server)
      .await;

    let result = check_for_update(true, "0.1.0", &server.uri())
      .await
      .unwrap();
    assert!(result.checked);
    assert!(result.available);
    assert_eq!(result.latest_version.as_deref(), Some("99.0.0"));

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    let headers = &requests[0].headers;
    assert_eq!(
      headers.get("user-agent").and_then(|v| v.to_str().ok()),
      Some(host_user_agent().as_str())
    );
    // No cookies, auth, or custom headers: only transport headers may ride along.
    for name in headers.keys() {
      assert!(
        ["host", "user-agent", "accept", "accept-encoding"].contains(&name.as_str()),
        "unexpected header on update check: {name}"
      );
    }
  }

  #[tokio::test]
  async fn check_for_update_makes_no_request_when_disabled() {
    use wiremock::MockServer;
    let server = MockServer::start().await;

    let result = check_for_update(false, "0.1.0", &server.uri())
      .await
      .unwrap();
    assert!(!result.checked);
    assert!(!result.available);
    assert!(server.received_requests().await.unwrap().is_empty());
  }

  #[test]
  fn mac_app_bundle_from_exe_walks_ancestors() {
    let exe = std::path::Path::new("/Applications/treq.app/Contents/MacOS/treq");
    assert_eq!(
      mac_app_bundle_from_exe(exe).as_deref(),
      Some(std::path::Path::new("/Applications/treq.app"))
    );
    assert_eq!(
      mac_app_bundle_from_exe(std::path::Path::new("/usr/local/bin/treq")),
      None
    );
  }

  #[test]
  fn find_extracted_app_bundle_requires_exactly_one() {
    let dir = tempfile::TempDir::new().unwrap();
    let err = find_extracted_app_bundle(dir.path()).unwrap_err();
    assert!(err.contains("No .app bundle"));

    std::fs::create_dir(dir.path().join("treq.app")).unwrap();
    assert_eq!(
      find_extracted_app_bundle(dir.path()).unwrap(),
      dir.path().join("treq.app")
    );

    std::fs::create_dir(dir.path().join("other.app")).unwrap();
    let err = find_extracted_app_bundle(dir.path()).unwrap_err();
    assert!(err.contains("Multiple"));
  }

  #[test]
  fn install_mac_update_rejects_when_unsupported() {
    if update_install_supported() {
      return;
    }
    let err = install_mac_update_from_url_with(
      "https://example.com/treq.app.tar.gz",
      |_url, _dest| Ok(()),
      || {
        Ok(std::path::PathBuf::from(
          "/Applications/treq.app/Contents/MacOS/treq",
        ))
      },
    )
    .unwrap_err();
    assert!(err.contains("only supported on macOS"));
  }
}
