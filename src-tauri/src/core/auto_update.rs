//! Auto-update checks against the marketing-site `/version` endpoint.
//! Install is enabled on macOS only, and only for bundles signed by the same
//! Developer ID team as the running app.

use std::cmp::Ordering;

const DEFAULT_VERSION_BASE_URL: &str = "https://treq.dev";
const GITHUB_RELEASES_BASE: &str = "https://github.com/treq-dev/treq/releases/download";

/// Production marketing-site origin used for `/version` checks.
pub fn default_version_base_url() -> &'static str {
  DEFAULT_VERSION_BASE_URL
}

/// Result of checking whether a newer app version is published.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
  /// Auto-update install is only supported on macOS.
  pub supported: bool,
  pub available: bool,
  pub current_version: String,
  pub latest_version: Option<String>,
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
  supported: bool,
) -> UpdateCheckResult {
  let current_version = current_version.trim().to_string();
  let latest = latest_version.trim();

  if !supported {
    return UpdateCheckResult {
      supported: false,
      available: false,
      current_version,
      latest_version: Some(latest.to_string()),
      download_url: None,
    };
  }

  if !is_newer_version(&current_version, latest) {
    return UpdateCheckResult {
      supported: true,
      available: false,
      current_version,
      latest_version: Some(latest.to_string()),
      download_url: None,
    };
  }

  UpdateCheckResult {
    supported: true,
    available: true,
    download_url: mac_app_download_url(latest, arch),
    current_version,
    latest_version: Some(latest.to_string()),
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

/// Whether auto-update install is enabled on this build target.
pub fn auto_update_supported() -> bool {
  cfg!(target_os = "macos")
}

/// Host arch string matching `std::env::consts::ARCH`.
pub fn host_arch() -> &'static str {
  std::env::consts::ARCH
}

/// Fetch a URL body as UTF-8 text via curl (available on macOS).
pub fn fetch_url_text(url: &str) -> Result<String, String> {
  let output = std::process::Command::new("curl")
    .args(["-fsSL", "--max-time", "15", url])
    .output()
    .map_err(|e| format!("Failed to run curl: {e}"))?;
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    return Err(format!("Failed to fetch {url}: {stderr}"));
  }
  String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 from {url}: {e}"))
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

/// Check `/version` and compare against the running app version.
pub fn check_for_update_with_fetcher<F>(
  current_version: &str,
  version_base_url: &str,
  arch: &str,
  supported: bool,
  fetch: F,
) -> Result<UpdateCheckResult, String>
where
  F: FnOnce(&str) -> Result<String, String>,
{
  let endpoint = version_endpoint_url(version_base_url);
  let body = fetch(&endpoint)?;
  let latest = parse_version_endpoint_body(&body)?;
  Ok(evaluate_update(current_version, &latest, arch, supported))
}

/// Production check against the live `/version` endpoint.
pub fn check_for_update(
  current_version: &str,
  version_base_url: &str,
) -> Result<UpdateCheckResult, String> {
  check_for_update_with_fetcher(
    current_version,
    version_base_url,
    host_arch(),
    auto_update_supported(),
    fetch_url_text,
  )
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

/// Extract `TeamIdentifier` from `codesign -dv` output (written to stderr).
/// Returns None for unsigned or ad-hoc signed bundles (`TeamIdentifier=not set`).
pub fn parse_codesign_team_id(output: &str) -> Option<String> {
  let team = output
    .lines()
    .find_map(|line| line.trim().strip_prefix("TeamIdentifier="))?
    .trim();
  let valid = !team.is_empty() && team.chars().all(|c| c.is_ascii_alphanumeric());
  valid.then(|| team.to_string())
}

/// Designated requirement: an Apple-issued Developer ID chain whose leaf belongs to `team_id`.
pub fn developer_id_requirement(team_id: &str) -> String {
  format!(
    "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists \
     and certificate leaf[field.1.2.840.113635.100.6.1.13] exists \
     and certificate leaf[subject.OU] = \"{team_id}\""
  )
}

/// Read the Developer ID team of a signed `.app` bundle.
pub fn codesign_team_id(app: &std::path::Path) -> Result<String, String> {
  let output = std::process::Command::new("codesign")
    .args(["-dv", "--verbose=2"])
    .arg(app)
    .output()
    .map_err(|e| format!("Failed to run codesign: {e}"))?;
  if !output.status.success() {
    return Err(format!("{} is not code signed", app.display()));
  }
  parse_codesign_team_id(&String::from_utf8_lossy(&output.stderr))
    .ok_or_else(|| format!("{} has no Developer ID team", app.display()))
}

/// Verify `new_app` is validly signed by the same Developer ID team as `current_app`.
pub fn verify_update_signature(
  new_app: &std::path::Path,
  current_app: &std::path::Path,
) -> Result<(), String> {
  let team_id = codesign_team_id(current_app)
    .map_err(|e| format!("Cannot verify update against the running app: {e}"))?;
  let requirement = format!("={}", developer_id_requirement(&team_id));
  let output = std::process::Command::new("codesign")
    .args(["--verify", "--deep", "--strict", "-R"])
    .arg(&requirement)
    .arg(new_app)
    .output()
    .map_err(|e| format!("Failed to run codesign: {e}"))?;
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    return Err(format!("Update signature check failed: {}", stderr.trim()));
  }
  Ok(())
}

/// Download the macOS updater archive and replace the running app bundle.
///
/// On non-macOS targets this always returns an error — install is Mac-only.
pub fn install_mac_update_from_url(download_url: &str) -> Result<(), String> {
  install_mac_update_from_url_with(
    download_url,
    download_url_to_file,
    || std::env::current_exe().map_err(|e| format!("Failed to resolve current executable: {e}")),
    verify_update_signature,
  )
}

/// Testable install path with injectable download, exe resolution, and signature check.
/// The bundle is only copied over the running app after `verify` succeeds.
pub fn install_mac_update_from_url_with<D, E, V>(
  download_url: &str,
  download: D,
  current_exe: E,
  verify: V,
) -> Result<(), String>
where
  D: FnOnce(&str, &std::path::Path) -> Result<(), String>,
  E: FnOnce() -> Result<std::path::PathBuf, String>,
  V: FnOnce(&std::path::Path, &std::path::Path) -> Result<(), String>,
{
  if !auto_update_supported() {
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
    verify(&new_app, &current_app)?;

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
    assert!(result.supported);
    assert!(!result.available);
    assert!(result.download_url.is_none());
  }

  #[test]
  fn evaluate_update_available_on_supported_platform() {
    let result = evaluate_update("0.1.3", "0.1.4", "aarch64", true);
    assert!(result.supported);
    assert!(result.available);
    assert_eq!(result.latest_version.as_deref(), Some("0.1.4"));
    assert!(result
      .download_url
      .as_deref()
      .unwrap()
      .ends_with("treq_aarch64.app.tar.gz"));
  }

  #[test]
  fn evaluate_update_not_available_when_unsupported() {
    let result = evaluate_update("0.1.3", "0.1.4", "aarch64", false);
    assert!(!result.supported);
    assert!(!result.available);
    assert!(result.download_url.is_none());
  }

  #[test]
  fn parse_version_endpoint_body_trims_and_validates() {
    assert_eq!(parse_version_endpoint_body("0.1.3\n").unwrap(), "0.1.3");
    assert!(parse_version_endpoint_body("").is_err());
    assert!(parse_version_endpoint_body("nope").is_err());
  }

  #[test]
  fn check_for_update_with_fetcher_reports_available() {
    let result =
      check_for_update_with_fetcher("0.1.3", "https://treq.dev", "aarch64", true, |_url| {
        Ok("0.1.4\n".to_string())
      })
      .unwrap();
    assert!(result.available);
    assert_eq!(result.latest_version.as_deref(), Some("0.1.4"));
  }

  #[test]
  fn check_for_update_with_fetcher_propagates_fetch_errors() {
    let err = check_for_update_with_fetcher("0.1.3", "https://treq.dev", "aarch64", true, |_url| {
      Err("network down".to_string())
    })
    .unwrap_err();
    assert!(err.contains("network down"));
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
    if auto_update_supported() {
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
      |_new, _current| Ok(()),
    )
    .unwrap_err();
    assert!(err.contains("only supported on macOS"));
  }

  #[test]
  fn parse_codesign_team_id_reads_developer_id_team() {
    let out = "Executable=/Applications/treq.app/Contents/MacOS/treq\n\
               Authority=Developer ID Application: Treq (ABCDE12345)\n\
               TeamIdentifier=ABCDE12345\n";
    assert_eq!(parse_codesign_team_id(out).as_deref(), Some("ABCDE12345"));
  }

  #[test]
  fn parse_codesign_team_id_rejects_unsigned_and_adhoc() {
    assert_eq!(parse_codesign_team_id("TeamIdentifier=not set\n"), None);
    assert_eq!(parse_codesign_team_id("Signature=adhoc\n"), None);
    assert_eq!(
      parse_codesign_team_id("TeamIdentifier=\"x\" or true\n"),
      None
    );
  }

  #[test]
  fn developer_id_requirement_pins_team() {
    let req = developer_id_requirement("ABCDE12345");
    assert!(req.starts_with("anchor apple generic"));
    assert!(req.ends_with("certificate leaf[subject.OU] = \"ABCDE12345\""));
  }
}
