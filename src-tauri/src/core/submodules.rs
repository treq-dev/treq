use crate::binary_paths;
use crate::jj;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Readonly checkout state of a Git submodule in a superproject working copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubmoduleState {
  Missing,
  Clean,
  Dirty,
  Diverged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitSubmodule {
  pub name: String,
  pub path: String,
  pub url: String,
  pub pin: String,
  pub head: Option<String>,
  pub state: SubmoduleState,
}

/// List Git submodules recorded in the current superproject commit.
///
/// Missing workspace paths return an empty list rather than an IO error.
pub fn list_submodules(
  repo_path: &str,
  workspace_id: Option<i64>,
) -> Result<Vec<GitSubmodule>, String> {
  let workspace_path = resolve_workspace_dir(repo_path, workspace_id)?;
  let root = Path::new(&workspace_path);
  if !root.exists() {
    return Ok(Vec::new());
  }

  let gitmodules = root.join(".gitmodules");
  if !gitmodules.is_file() {
    return Ok(Vec::new());
  }
  let contents = match fs::read_to_string(&gitmodules) {
    Ok(text) => text,
    Err(_) => return Ok(Vec::new()),
  };
  let declared = parse_gitmodules(&contents);
  if declared.is_empty() {
    return Ok(Vec::new());
  }

  let git_repo_path =
    jj::derive_repo_path_from_workspace(&workspace_path).unwrap_or_else(|| workspace_path.clone());
  let pins = gitlinks_for_workspace(&workspace_path, &git_repo_path);

  let mut result = Vec::new();
  for spec in declared {
    let pin = pins.get(&spec.path).cloned().unwrap_or_default();
    result.push(inspect_submodule(root, spec, pin));
  }
  Ok(result)
}

/// Clone or fetch each submodule and check out the superproject pin detached.
pub fn update_submodules(
  repo_path: &str,
  workspace_id: Option<i64>,
  path: Option<&str>,
) -> Result<Vec<GitSubmodule>, String> {
  let workspace_path = resolve_workspace_dir(repo_path, workspace_id)?;
  let listed = list_submodules(repo_path, workspace_id)?;
  let git_repo_path =
    jj::derive_repo_path_from_workspace(&workspace_path).unwrap_or_else(|| workspace_path.clone());

  for submodule in &listed {
    if let Some(only) = path {
      if submodule.path != only {
        continue;
      }
    }
    if submodule.pin.is_empty() {
      return Err(format!(
        "Submodule '{}' has no gitlink pin in the current commit",
        submodule.path
      ));
    }
    populate_submodule(&git_repo_path, &workspace_path, submodule)?;
  }

  list_submodules(repo_path, workspace_id)
}

fn resolve_workspace_dir(repo_path: &str, workspace_id: Option<i64>) -> Result<String, String> {
  crate::core::resolve_workspace_dir(repo_path, workspace_id)
}

#[derive(Debug, Clone)]
struct SubmoduleSpec {
  name: String,
  path: String,
  url: String,
}

fn parse_gitmodules(contents: &str) -> Vec<SubmoduleSpec> {
  let mut specs: BTreeMap<String, SubmoduleSpec> = BTreeMap::new();
  let mut current: Option<String> = None;

  for raw in contents.lines() {
    let line = raw.trim();
    if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
      continue;
    }
    if let Some(rest) = line.strip_prefix("[submodule ") {
      if let Some(name) = rest.strip_suffix(']').map(unquote_config_value) {
        current = Some(name.clone());
        specs.entry(name.clone()).or_insert(SubmoduleSpec {
          name,
          path: String::new(),
          url: String::new(),
        });
      }
      continue;
    }
    let Some(name) = current.as_ref() else {
      continue;
    };
    let Some((key, value)) = line.split_once('=') else {
      continue;
    };
    let key = key.trim();
    let value = unquote_config_value(value.trim());
    if let Some(spec) = specs.get_mut(name) {
      match key {
        "path" => spec.path = value,
        "url" => spec.url = value,
        _ => {}
      }
    }
  }

  specs
    .into_values()
    .filter(|spec| !spec.path.is_empty() && !spec.url.is_empty())
    .collect()
}

fn unquote_config_value(value: &str) -> String {
  let trimmed = value.trim();
  if (trimmed.starts_with('"') && trimmed.ends_with('"'))
    || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
  {
    trimmed[1..trimmed.len() - 1].to_string()
  } else {
    trimmed.to_string()
  }
}

fn gitlinks_for_workspace(workspace_path: &str, git_repo_path: &str) -> BTreeMap<String, String> {
  if let Some(commit_hex) = working_copy_commit_hex(workspace_path) {
    let pins = gitlinks_from_rev(git_repo_path, &commit_hex);
    if !pins.is_empty() {
      return pins;
    }
  }
  gitlinks_from_rev(git_repo_path, "HEAD")
}

fn working_copy_commit_hex(workspace_path: &str) -> Option<String> {
  jj::jj_working_copy_commit_hex(workspace_path)
}

fn gitlinks_from_rev(git_repo_path: &str, rev: &str) -> BTreeMap<String, String> {
  // ast-grep-ignore: no-command-for-jj-or-git-tauri-src
  let output = git_command()
    .current_dir(git_repo_path)
    .args(["ls-tree", "-r", rev])
    .output();
  let Ok(output) = output else {
    return BTreeMap::new();
  };
  if !output.status.success() {
    return BTreeMap::new();
  }
  let mut out = BTreeMap::new();
  for line in String::from_utf8_lossy(&output.stdout).lines() {
    // 160000 commit <oid>\t<path>
    let Some((meta, path)) = line.split_once('\t') else {
      continue;
    };
    let mut parts = meta.split_whitespace();
    let Some(mode) = parts.next() else { continue };
    let Some(kind) = parts.next() else { continue };
    let Some(oid) = parts.next() else { continue };
    if mode == "160000" && kind == "commit" {
      out.insert(path.to_string(), oid.to_string());
    }
  }
  out
}

fn inspect_submodule(workspace_root: &Path, spec: SubmoduleSpec, pin: String) -> GitSubmodule {
  let checkout = workspace_root.join(&spec.path);
  if !submodule_git_present(&checkout) {
    return GitSubmodule {
      name: spec.name,
      path: spec.path,
      url: spec.url,
      pin,
      head: None,
      state: SubmoduleState::Missing,
    };
  }

  let head = nested_head_hex(&checkout);
  let dirty = nested_is_dirty(&checkout);
  let state = match &head {
    Some(head) if !pin.is_empty() && !ids_match(head, &pin) => SubmoduleState::Diverged,
    Some(_) if dirty => SubmoduleState::Dirty,
    Some(_) => SubmoduleState::Clean,
    None => SubmoduleState::Missing,
  };

  GitSubmodule {
    name: spec.name,
    path: spec.path,
    url: spec.url,
    pin,
    head,
    state,
  }
}

fn submodule_git_present(checkout: &Path) -> bool {
  let marker = checkout.join(".git");
  marker.is_file() || marker.is_dir()
}

fn nested_head_hex(checkout: &Path) -> Option<String> {
  let repo = gix::open(checkout).ok()?;
  let id = repo.head_id().ok()?;
  Some(id.to_string())
}

fn nested_is_dirty(checkout: &Path) -> bool {
  // ast-grep-ignore: no-command-for-jj-or-git-tauri-src
  let output = git_command()
    .current_dir(checkout)
    .args(["status", "--porcelain"])
    .output();
  match output {
    Ok(out) if out.status.success() => !out.stdout.is_empty(),
    _ => false,
  }
}

fn ids_match(left: &str, right: &str) -> bool {
  let a = left.trim().to_ascii_lowercase();
  let b = right.trim().to_ascii_lowercase();
  a == b || a.starts_with(&b) || b.starts_with(&a)
}

fn populate_submodule(
  git_repo_path: &str,
  workspace_path: &str,
  submodule: &GitSubmodule,
) -> Result<(), String> {
  let modules_dir = Path::new(git_repo_path)
    .join(".git")
    .join("modules")
    .join(&submodule.name);
  if let Some(parent) = modules_dir.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create modules dir: {e}"))?;
  }

  if !modules_dir.join("HEAD").is_file() && !modules_dir.join("objects").is_dir() {
    if modules_dir.exists() {
      fs::remove_dir_all(&modules_dir)
        .map_err(|e| format!("Failed to clear incomplete submodule store: {e}"))?;
    }
    run_git_with_config(
      git_repo_path,
      &[
        "clone",
        "--",
        &submodule.url,
        &modules_dir.to_string_lossy(),
      ],
    )?;
  } else {
    let _ = run_git(
      modules_dir.to_string_lossy().as_ref(),
      &["fetch", "--all", "--tags"],
    );
  }

  let checkout = Path::new(workspace_path).join(&submodule.path);
  if let Some(parent) = checkout.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create submodule path: {e}"))?;
  }
  fs::create_dir_all(&checkout).map_err(|e| format!("Failed to create submodule checkout: {e}"))?;
  write_gitfile(&checkout, &modules_dir)?;

  let work_tree = checkout.to_string_lossy().into_owned();
  let git_dir = modules_dir.to_string_lossy().into_owned();
  // ast-grep-ignore: no-command-for-jj-or-git-tauri-src
  let output = git_command()
    .args([
      "--git-dir",
      &git_dir,
      "--work-tree",
      &work_tree,
      "checkout",
      "--detach",
      "--force",
      &submodule.pin,
    ])
    .output()
    .map_err(|e| format!("Failed to check out submodule '{}': {e}", submodule.path))?;
  if !output.status.success() {
    return Err(format!(
      "Failed to check out submodule '{}' at {}: {}{}",
      submodule.path,
      submodule.pin,
      String::from_utf8_lossy(&output.stdout),
      String::from_utf8_lossy(&output.stderr)
    ));
  }
  Ok(())
}

fn write_gitfile(checkout: &Path, modules_dir: &Path) -> Result<(), String> {
  let gitfile = checkout.join(".git");
  if gitfile.is_dir() {
    return Ok(());
  }
  let relative = pathdiff_to_modules(checkout, modules_dir);
  fs::write(&gitfile, format!("gitdir: {}\n", relative))
    .map_err(|e| format!("Failed to write gitfile: {e}"))
}

fn pathdiff_to_modules(checkout: &Path, modules_dir: &Path) -> String {
  let mut prefix = PathBuf::new();
  let depth = checkout.components().count();
  // gitfile lives inside checkout, so walk from checkout to root then to modules.
  // Prefer a relative path Git accepts; fall back to absolute.
  for _ in 0..depth {
    prefix.push("..");
  }
  let _ = prefix;
  modules_dir.to_string_lossy().into_owned()
}

fn git_command() -> Command {
  match binary_paths::get_binary_path("git") {
    Some(path) => Command::new(path),
    // ast-grep-ignore: no-command-for-jj-or-git-tauri-src
    None => Command::new("git"),
  }
}

fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
  run_git_with_config(cwd, args)
}

fn run_git_with_config(cwd: &str, args: &[&str]) -> Result<String, String> {
  // ast-grep-ignore: no-command-for-jj-or-git-tauri-src
  let output = git_command()
    .current_dir(cwd)
    .args(["-c", "protocol.file.allow=always"])
    .args(args)
    .output()
    .map_err(|e| format!("git {} failed: {e}", args.join(" ")))?;
  if !output.status.success() {
    return Err(format!(
      "git {} failed: {}{}",
      args.join(" "),
      String::from_utf8_lossy(&output.stdout),
      String::from_utf8_lossy(&output.stderr)
    ));
  }
  Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

const SUBMODULE_SYNC_KEY: &str = "submodule_sync";

fn load_submodule_sync_map(repo_path: &str) -> BTreeMap<String, bool> {
  let app_db_path = crate::core::resolve_app_db_path(repo_path);
  if !app_db_path.exists() {
    return BTreeMap::new();
  }
  let Ok(db) = crate::db::Database::new(app_db_path) else {
    return BTreeMap::new();
  };
  let Ok(Some(raw)) = db.get_repo_setting(repo_path, SUBMODULE_SYNC_KEY) else {
    return BTreeMap::new();
  };
  serde_json::from_str(&raw).unwrap_or_default()
}

fn save_submodule_sync_map(repo_path: &str, map: &BTreeMap<String, bool>) -> Result<(), String> {
  let app_db_path = crate::core::resolve_app_db_path(repo_path);
  let db = crate::db::Database::new(app_db_path).map_err(|e| e.to_string())?;
  db.init().map_err(|e| e.to_string())?;
  let raw = serde_json::to_string(map).map_err(|e| e.to_string())?;
  db.set_repo_setting(repo_path, SUBMODULE_SYNC_KEY, &raw)
    .map_err(|e| e.to_string())
}

/// Persist whether `path` should be populated in every workspace, then apply it.
///
/// Default is off. Enabling clones/checks out the pin in the home repo and all
/// registered workspaces. Disabling only clears the preference.
pub fn set_submodule_synced(
  repo_path: &str,
  path: &str,
  enabled: bool,
) -> Result<Vec<GitSubmodule>, String> {
  let mut map = load_submodule_sync_map(repo_path);
  if enabled {
    map.insert(path.to_string(), true);
  } else {
    map.remove(path);
  }
  save_submodule_sync_map(repo_path, &map)?;
  if enabled {
    populate_submodule_everywhere(repo_path, path)?;
  }
  list_submodules(repo_path, None)
}

/// Populate every submodule marked synced into one working copy.
pub fn populate_synced_submodules(
  repo_path: &str,
  workspace_id: Option<i64>,
) -> Result<(), String> {
  for (path, enabled) in load_submodule_sync_map(repo_path) {
    if enabled {
      update_submodules(repo_path, workspace_id, Some(&path))?;
    }
  }
  Ok(())
}

fn populate_submodule_everywhere(repo_path: &str, path: &str) -> Result<(), String> {
  update_submodules(repo_path, None, Some(path))?;
  if let Ok(workspaces) = crate::core::list_workspaces(repo_path) {
    for workspace in workspaces {
      update_submodules(repo_path, Some(workspace.id), Some(path))?;
    }
  }
  Ok(())
}

/// Inject gitlink rows into a depth-1 directory listing, using the full
/// submodule path as `name` even when the checkout is nested.
pub fn merge_submodules_into_entries(
  repo_path: &str,
  workspace_id: Option<i64>,
  workspace_root: &str,
  entries: &mut Vec<crate::core::WorkspaceEntry>,
) {
  let Ok(listed) = list_submodules(repo_path, workspace_id) else {
    return;
  };
  if listed.is_empty() {
    return;
  }
  let sync = load_submodule_sync_map(repo_path);
  let base = Path::new(workspace_root);
  for submodule in listed {
    let entry_path = base.join(&submodule.path);
    let modified_at = fs::metadata(&entry_path)
      .ok()
      .and_then(|metadata| metadata.modified().ok())
      .map(|modified| chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339());
    let entry = crate::core::WorkspaceEntry {
      name: submodule.path.clone(),
      path: entry_path.to_string_lossy().into_owned(),
      is_directory: true,
      modified_at,
      submodule_pin: Some(submodule.pin),
      submodule_synced: Some(sync.get(&submodule.path).copied().unwrap_or(false)),
      status: None,
    };
    if let Some(index) = entries
      .iter()
      .position(|existing| existing.name == submodule.path)
    {
      entries[index] = entry;
    } else {
      entries.push(entry);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::TempDir;

  fn run(cwd: &Path, program: &str, args: &[&str]) {
    let output = Command::new(program)
      .current_dir(cwd)
      .args(args)
      .output()
      .unwrap_or_else(|e| panic!("{program} {:?}: {e}", args));
    assert!(
      output.status.success(),
      "{program} {:?} failed: {}{}",
      args,
      String::from_utf8_lossy(&output.stdout),
      String::from_utf8_lossy(&output.stderr)
    );
  }

  fn git(cwd: &Path, args: &[&str]) {
    run(cwd, "git", args);
  }

  fn git_allow_file(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
      .current_dir(cwd)
      .args(["-c", "protocol.file.allow=always"])
      .args(args)
      .output()
      .unwrap_or_else(|e| panic!("git {:?}: {e}", args));
    assert!(
      output.status.success(),
      "git {:?} failed: {}{}",
      args,
      String::from_utf8_lossy(&output.stdout),
      String::from_utf8_lossy(&output.stderr)
    );
  }

  fn init_git_repo(dir: &Path) {
    git(dir, &["init"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "user.name", "Test User"]);
    fs::write(dir.join("README.md"), "sub\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-m", "init"]);
  }

  fn create_superproject_with_submodule() -> (TempDir, String, String) {
    let temp = TempDir::new().unwrap();
    let sub = temp.path().join("sub");
    let superproject = temp.path().join("super");
    fs::create_dir_all(&sub).unwrap();
    fs::create_dir_all(&superproject).unwrap();
    init_git_repo(&sub);
    init_git_repo(&superproject);

    git_allow_file(
      &superproject,
      &["submodule", "add", sub.to_str().unwrap(), "vendor/lib"],
    );
    git(&superproject, &["commit", "-m", "add submodule"]);
    crate::core::init(superproject.to_str().unwrap()).unwrap();

    (
      temp,
      superproject.to_string_lossy().into_owned(),
      sub.to_string_lossy().into_owned(),
    )
  }

  #[test]
  fn parse_gitmodules_reads_path_and_url() {
    let parsed = parse_gitmodules(
      r#"
[submodule "vendor/lib"]
	path = vendor/lib
	url = https://example.com/lib.git
"#,
    );
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].name, "vendor/lib");
    assert_eq!(parsed[0].path, "vendor/lib");
    assert_eq!(parsed[0].url, "https://example.com/lib.git");
  }

  #[test]
  fn list_submodules_returns_empty_when_path_missing() {
    let listed = list_submodules("/tmp/treq-does-not-exist-submodules", None).unwrap();
    assert!(listed.is_empty());
  }

  #[test]
  fn list_submodules_returns_empty_without_gitmodules() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("README"), "x\n").unwrap();
    let listed = list_submodules(temp.path().to_str().unwrap(), None).unwrap();
    assert!(listed.is_empty());
  }

  #[test]
  fn list_submodules_reports_clean_populated_checkout() {
    let (_temp, superproject, _) = create_superproject_with_submodule();
    let listed = list_submodules(&superproject, None).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].path, "vendor/lib");
    assert!(!listed[0].pin.is_empty());
    assert_eq!(listed[0].state, SubmoduleState::Clean);
    assert!(listed[0].head.is_some());
  }

  #[test]
  fn list_submodules_reports_missing_after_checkout_removed() {
    let (_temp, superproject, _) = create_superproject_with_submodule();
    fs::remove_dir_all(Path::new(&superproject).join("vendor/lib")).unwrap();
    let listed = list_submodules(&superproject, None).unwrap();
    assert_eq!(listed[0].state, SubmoduleState::Missing);
    assert!(listed[0].head.is_none());
  }

  #[test]
  fn update_submodules_restores_missing_checkout_to_pin() {
    let (_temp, superproject, _) = create_superproject_with_submodule();
    fs::remove_dir_all(Path::new(&superproject).join("vendor/lib")).unwrap();
    let updated = update_submodules(&superproject, None, None).unwrap();
    assert_eq!(updated.len(), 1);
    assert_eq!(updated[0].state, SubmoduleState::Clean);
    assert!(Path::new(&superproject).join("vendor/lib/.git").exists());
    let head = updated[0].head.as_deref().unwrap();
    assert!(ids_match(head, &updated[0].pin));
  }

  #[test]
  fn list_submodules_reports_dirty_when_nested_files_change() {
    let (_temp, superproject, _) = create_superproject_with_submodule();
    fs::write(
      Path::new(&superproject).join("vendor/lib/README.md"),
      "dirty\n",
    )
    .unwrap();
    let listed = list_submodules(&superproject, None).unwrap();
    assert_eq!(listed[0].state, SubmoduleState::Dirty);
  }

  #[test]
  fn ls_workspace_lists_nested_submodule_path_with_pin_unsynced() {
    let (_temp, superproject, _) = create_superproject_with_submodule();
    let entries = crate::core::ls_workspace(&superproject, None).unwrap();
    let row = entries
      .iter()
      .find(|entry| entry.name == "vendor/lib")
      .expect("nested submodule path should appear in the directory list");
    assert!(row.is_directory);
    assert!(row
      .submodule_pin
      .as_ref()
      .is_some_and(|pin| !pin.is_empty()));
    assert_eq!(row.submodule_synced, Some(false));
  }

  #[test]
  fn set_submodule_synced_defaults_off_and_populates_when_enabled() {
    let (_temp, superproject, _) = create_superproject_with_submodule();
    fs::remove_dir_all(Path::new(&superproject).join("vendor/lib")).unwrap();

    let listed = crate::core::ls_workspace(&superproject, None).unwrap();
    let row = listed
      .iter()
      .find(|entry| entry.name == "vendor/lib")
      .unwrap();
    assert_eq!(row.submodule_synced, Some(false));

    set_submodule_synced(&superproject, "vendor/lib", true).unwrap();
    assert!(Path::new(&superproject).join("vendor/lib/.git").exists());
    let listed = crate::core::ls_workspace(&superproject, None).unwrap();
    let row = listed
      .iter()
      .find(|entry| entry.name == "vendor/lib")
      .unwrap();
    assert_eq!(row.submodule_synced, Some(true));
  }

  #[test]
  fn set_submodule_synced_populates_existing_and_new_workspaces() {
    let (_temp, superproject, _) = create_superproject_with_submodule();
    let workspace =
      crate::core::create_workspace(&superproject, "feat/sub-sync", None, None, None, None, None)
        .unwrap();
    let workspace_root = Path::new(&superproject)
      .join(".treq")
      .join("workspaces")
      .join(&workspace.workspace_path);
    fs::remove_dir_all(workspace_root.join("vendor/lib")).ok();
    fs::remove_dir_all(Path::new(&superproject).join("vendor/lib")).ok();

    set_submodule_synced(&superproject, "vendor/lib", true).unwrap();
    assert!(workspace_root.join("vendor/lib/.git").exists());

    let second = crate::core::create_workspace(
      &superproject,
      "feat/sub-sync-2",
      None,
      None,
      None,
      None,
      None,
    )
    .unwrap();
    let second_root = Path::new(&superproject)
      .join(".treq")
      .join("workspaces")
      .join(&second.workspace_path);
    assert!(second_root.join("vendor/lib/.git").exists());
  }
}
