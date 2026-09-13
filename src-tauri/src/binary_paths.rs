use std::collections::HashMap;
use std::env;
use std::process::Command;
use std::sync::OnceLock;

static BINARY_PATHS_CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();

/// Get extended PATH that includes common binary locations
pub fn get_extended_path() -> String {
  let current_path = env::var("PATH").unwrap_or_default();

  if cfg!(windows) {
    // The extra locations and `:` joiner below are Unix-specific (Homebrew,
    // /usr/bin, etc.) and would clobber the inherited PATH — which includes
    // System32 and PowerShell's own directory — with a broken value. Just
    // append the running exe's directory, using the Windows `;` separator.
    let mut all_paths: Vec<String> = current_path
      .split(';')
      .filter(|p| !p.is_empty())
      .map(String::from)
      .collect();
    if let Ok(exe_path) = std::env::current_exe() {
      if let Some(exe_dir) = exe_path.parent() {
        let exe_dir_str = exe_dir.to_string_lossy().to_string();
        if !exe_dir_str.is_empty() && !all_paths.contains(&exe_dir_str) {
          all_paths.push(exe_dir_str);
        }
      }
    }
    return all_paths.join(";");
  }

  // Common binary locations to add
  let additional_paths = [
    "/opt/homebrew/bin", // macOS ARM Homebrew
    "/usr/local/bin",    // macOS Intel Homebrew, common
    "~/.cargo/bin",      // Rust tools
    "/usr/bin",          // System binaries
    "/bin",              // System binaries
  ];

  // Expand ~ to home directory
  let home = env::var("HOME").unwrap_or_default();
  let expanded_paths: Vec<String> = additional_paths
    .iter()
    .map(|p| p.replace('~', &home))
    .collect();

  // Combine existing PATH with additional paths (deduplicating)
  let mut all_paths: Vec<String> = current_path
    .split(':')
    .filter(|p| !p.is_empty())
    .map(String::from)
    .collect();

  // Add additional paths if not already present
  for path in expanded_paths {
    if !all_paths.contains(&path) {
      all_paths.push(path);
    }
  }

  // Add the running treq binary directory so `treq` is available in PTY sessions.
  if let Ok(exe_path) = std::env::current_exe() {
    if let Some(exe_dir) = exe_path.parent() {
      let exe_dir_str = exe_dir.to_string_lossy().to_string();
      if !exe_dir_str.is_empty() && !all_paths.contains(&exe_dir_str) {
        all_paths.push(exe_dir_str);
      }
    }
  }

  all_paths.join(":")
}

/// Get the directory containing the running treq executable
pub fn get_exe_dir() -> Option<String> {
  let exe_path = std::env::current_exe().ok()?;
  let exe_dir = exe_path.parent()?;
  let dir_str = exe_dir.to_string_lossy().to_string();
  if dir_str.is_empty() {
    None
  } else {
    Some(dir_str)
  }
}

/// Detect binary path using `which` (Unix) or `where` (Windows) with extended PATH
pub fn detect_binary(name: &str) -> Option<String> {
  if cfg!(windows) {
    // `which` isn't available by default on Windows, and `get_extended_path`
    // joins entries with `:` (a Unix path separator), so neither applies here.
    // `where` uses the process's own PATH and is present on all supported Windows versions.
    let output = Command::new("where").arg(name).output().ok()?;

    if output.status.success() {
      let stdout = String::from_utf8(output.stdout).ok()?;
      let path = stdout.lines().next().unwrap_or("").trim().to_string();
      if !path.is_empty() {
        return Some(path);
      }
    }

    return None;
  }

  let extended_path = get_extended_path();

  // Try using `which` with extended PATH
  let output = Command::new("which")
    .arg(name)
    .env("PATH", extended_path)
    .output()
    .ok()?;

  if output.status.success() {
    let path = String::from_utf8(output.stdout).ok()?;
    let path = path.trim().to_string();
    if !path.is_empty() {
      return Some(path);
    }
  }

  None
}

/// Initialize binary paths cache with detected paths
pub fn init_binary_paths_cache(paths: HashMap<String, String>) {
  let _ = BINARY_PATHS_CACHE.set(paths);
}

/// Get cached binary path for a given binary name
pub fn get_binary_path(name: &str) -> Option<String> {
  BINARY_PATHS_CACHE.get()?.get(name).cloned()
}

/// Detect installed editor applications using mdfind
pub fn detect_editor_app(app_name: &str) -> bool {
  let search_pattern = "kMDItemKind == 'Application'";

  let output = Command::new("mdfind").arg(search_pattern).output().ok();

  if let Some(output) = output {
    if output.status.success() {
      let stdout = String::from_utf8_lossy(&output.stdout);
      let app_file = format!("/{}.app", app_name);
      return stdout.lines().any(|line| line.ends_with(&app_file));
    }
  }

  false
}

static EDITOR_APPS_CACHE: OnceLock<HashMap<String, bool>> = OnceLock::new();

/// Initialize editor apps cache
pub fn init_editor_apps_cache(apps: HashMap<String, bool>) {
  let _ = EDITOR_APPS_CACHE.set(apps);
}

/// Get a cached editor-apps snapshot if initialized.
pub fn get_editor_apps_cache() -> Option<HashMap<String, bool>> {
  EDITOR_APPS_CACHE.get().cloned()
}
