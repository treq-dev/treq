use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tempfile::TempDir;

#[allow(dead_code)]
pub const PASSING_WORKFLOW: &str = "
name: Passing CI
on:
  workflow_dispatch: {}
jobs:
  greet:
    name: Greet Job
    steps:
      - name: Say hello
        run: echo hello
      - name: Say world
        run: echo world
";

#[allow(dead_code)]
pub const FAILING_WORKFLOW: &str = "
name: Failing CI
on:
  workflow_dispatch: {}
jobs:
  check:
    name: Check Job
    steps:
      - name: Fail here
        run: exit 1
      - name: Never runs
        run: echo skipped
";


fn random_default_branch_name() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("branch-{nanos}-{seq}")
}

#[allow(dead_code)]
pub struct TestRepo {
    pub temp_dir: TempDir,
    pub repo_path: String,
    default_branch: String,
}

#[allow(dead_code)]
impl TestRepo {
    /// Creates a new temporary Git repository for testing.
    /// Simulates cloning a git repo by initializing with proper git config.
    /// Calls `core::init()` to initialize jj and local db.
    pub fn new() -> Result<Self, String> {
        Self::create(true)
    }

    /// Creates a new temporary Git repository without jj/db initialization.
    pub fn new_without_init() -> Result<Self, String> {
        Self::create(false)
    }

    fn create(init: bool) -> Result<Self, String> {
        let temp_dir = TempDir::new().map_err(|e| format!("Failed to create temp dir: {}", e))?;
        let repo_path = temp_dir.path().to_string_lossy().to_string();

        // Initialize git repo
        Self::run_git(&repo_path, &["init"])?;

        // Configure git user (required for commits)
        Self::run_git(&repo_path, &["config", "user.email", "test@example.com"])?;
        Self::run_git(&repo_path, &["config", "user.name", "Test User"])?;

        let default_branch = random_default_branch_name();
        Self::run_git(&repo_path, &["branch", "-M", &default_branch])
            .map_err(|e| format!("Failed to create default branch: {}", e))?;

        Self::run_git(&repo_path, &["checkout", "-b", &default_branch])?;

        // Record the default branch in local git config so get_default_branch() can
        // discover it via the merged init.defaultBranch fallback, even when HEAD moves
        // to a feature branch and there is no remote or main/master branch.
        Self::run_git(
            &repo_path,
            &["config", "init.defaultBranch", &default_branch],
        )
        .map_err(|e| format!("Failed to set init.defaultBranch: {}", e))?;

        // Create initial commit (git repos need at least one commit)
        let readme_path = temp_dir.path().join("README.md");
        fs::write(&readme_path, "# Test Repository\n")
            .map_err(|e| format!("Failed to write README: {}", e))?;

        Self::run_git(&repo_path, &["add", "."])?;
        Self::run_git(&repo_path, &["commit", "-m", "Initial commit"])?;

        if init {
            treq_lib::core::init(&repo_path)?;
        }

        Ok(TestRepo {
            temp_dir,
            repo_path,
            default_branch,
        })
    }

    /// Returns the repository's default branch name (set at creation time).
    pub fn default_branch(&self) -> &str {
        &self.default_branch
    }

    /// Full on-disk path for a workspace's working copy.
    pub fn workspace_full_path(&self, ws: &treq_lib::local_db::Workspace) -> String {
        self.workspaces_dir()
            .join(&ws.workspace_path)
            .to_string_lossy()
            .to_string()
    }

    /// Create a workspace with no description/moved-files/source/sparse options set.
    pub fn create_workspace_simple(
        &self,
        branch_name: &str,
    ) -> Result<treq_lib::local_db::Workspace, String> {
        treq_lib::core::create_workspace(
            &self.repo_path,
            branch_name,
            Some(branch_name.to_string()),
            None,
            None,
            None,
            None,
        )
    }

    /// Create a workspace (optionally stacked on `source_branch`), write `filename` with
    /// `content`, and commit it (no push).
    pub fn create_workspace_with_commit(
        &self,
        branch_name: &str,
        filename: &str,
        content: &str,
        source_branch: Option<&str>,
    ) -> Result<treq_lib::local_db::Workspace, String> {
        let ws = treq_lib::core::create_workspace(
            &self.repo_path,
            branch_name,
            Some(branch_name.to_string()),
            None,
            source_branch,
            None,
            None,
        )?;
        let full_path = self.workspace_full_path(&ws);
        Self::write_workspace_file(&full_path, filename, content)?;
        treq_lib::core::commit_workspace(&self.repo_path, ws.id, &format!("Add {}", filename))?;
        Ok(ws)
    }

    /// Create a workspace, make a local commit, and push it to the remote
    /// (requires `with_remote()`). Fetches afterward so the home repo sees the push.
    pub fn setup_workspace_with_pushed_commit(
        &self,
        branch_name: &str,
        filename: &str,
        content: &str,
    ) -> Result<treq_lib::local_db::Workspace, String> {
        let ws = self.create_workspace_with_commit(branch_name, filename, content, None)?;
        let full_path = self.workspace_full_path(&ws);

        treq_lib::jj::jj_push(&full_path).map_err(|e| e.to_string())?;
        treq_lib::jj::jj_git_fetch(&self.repo_path).map_err(|e| e.to_string())?;

        Ok(ws)
    }

    /// Creates a test repo with a remote origin for testing remote branch operations.
    /// Calls `core::init()` to initialize jj and local db.
    pub fn with_remote() -> Result<Self, String> {
        Self::with_remote_create(true)
    }

    /// Creates a test repo with a remote origin, without jj/db initialization.
    pub fn with_remote_without_init() -> Result<Self, String> {
        Self::with_remote_create(false)
    }

    fn with_remote_create(init: bool) -> Result<Self, String> {
        let repo = Self::create(init)?;

        // Create a "remote" repository
        let remote_dir = repo.temp_dir.path().join("remote.git");
        fs::create_dir_all(&remote_dir)
            .map_err(|e| format!("Failed to create remote dir: {}", e))?;

        let remote_path = remote_dir.to_string_lossy().to_string();
        Self::run_git(&remote_path, &["init", "--bare"])?;

        // Add remote to main repo
        Self::run_git(&repo.repo_path, &["remote", "add", "origin", &remote_path])?;

        // Push default branch to remote
        let default_branch = repo.default_branch();
        Self::run_git(&repo.repo_path, &["push", "-u", "origin", default_branch])?;
        Self::run_git(
            &repo.repo_path,
            &["remote", "set-head", "origin", default_branch],
        )?;
        // Create a remote branch with a commit for testing
        // The test expects a "feature.txt" file in the remote branch
        Self::run_git(&repo.repo_path, &["checkout", "-b", "feature-remote"])?;

        let feature_file = repo.temp_dir.path().join("feature.txt");
        fs::write(&feature_file, "This is a feature from remote branch")
            .map_err(|e| format!("Failed to write feature file: {}", e))?;

        Self::run_git(&repo.repo_path, &["add", "feature.txt"])?;
        Self::run_git(&repo.repo_path, &["commit", "-m", "Add feature.txt"])?;

        // Push the feature branch to remote
        Self::run_git(&repo.repo_path, &["push", "-u", "origin", "feature-remote"])?;

        // Return to default branch
        Self::run_git(&repo.repo_path, &["checkout", default_branch])?;

        // Fetch to ensure jj knows about the remote branch
        if init {
            let _ = treq_lib::jj::jj_git_fetch(&repo.repo_path);
        }

        Ok(repo)
    }

    /// Run a git command in the specified directory.
    pub fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
        let output = Command::new("git")
            .current_dir(cwd)
            .args(args)
            .output()
            .map_err(|e| format!("Failed to execute git: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "Git command failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Run a jj command in the specified directory.
    pub fn run_jj(cwd: &str, args: &[&str]) -> Result<String, String> {
        let jj_binary =
            treq_lib::binary_paths::detect_binary("jj").unwrap_or_else(|| "jj".to_string());
        let output = Command::new(jj_binary)
            .current_dir(cwd)
            .args(args)
            .output()
            .map_err(|e| format!("Failed to execute jj {:?}: {}", args, e))?;

        if !output.status.success() {
            return Err(format!(
                "jj {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Create a file in the repository.
    pub fn create_file(&self, relative_path: &str, content: &str) -> Result<PathBuf, String> {
        let file_path = Path::new(&self.repo_path).join(relative_path);
        Self::write_file_at_path(file_path.clone(), content, false)?;

        Ok(file_path)
    }

    /// Write a YAML workflow file to `.treq/workflows/{filename}` in the repo.
    pub fn write_workflow(&self, filename: &str, content: &str) -> Result<PathBuf, String> {
        self.create_file(&format!(".treq/workflows/{}", filename), content)
    }

    /// Write or append file content at an absolute path.
    fn write_file_at_path(file_path: PathBuf, content: &str, append: bool) -> Result<(), String> {
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
        }

        if append {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&file_path)
                .map_err(|e| format!("Failed to open file for append: {}", e))?;
            file.write_all(content.as_bytes())
                .map_err(|e| format!("Failed to append file: {}", e))?;
        } else {
            fs::write(&file_path, content).map_err(|e| format!("Failed to write file: {}", e))?;
        }

        Ok(())
    }

    /// Create or overwrite a file inside a workspace path.
    pub fn write_workspace_file(
        workspace_path: &str,
        relative_path: &str,
        content: &str,
    ) -> Result<PathBuf, String> {
        let file_path = Path::new(workspace_path).join(relative_path);
        Self::write_file_at_path(file_path.clone(), content, false)?;
        Ok(file_path)
    }

    /// Recursively remove a directory (e.g. `.jj` or a workspace path) from tests.
    /// Keeps `fs::remove_dir_all` out of `*_test.rs` for ast-grep `no-fs-mutation-in-test-files`.
    pub fn remove_dir_all_path(path: impl AsRef<Path>) -> Result<(), String> {
        fs::remove_dir_all(path.as_ref()).map_err(|e| e.to_string())
    }

    /// Remove a single file from tests (avoids `fs::remove_file` in `*_test.rs`).
    pub fn remove_file_path(path: impl AsRef<Path>) -> Result<(), String> {
        fs::remove_file(path.as_ref()).map_err(|e| e.to_string())
    }

    /// Create a directory and any missing parents (avoids `fs::create_dir_all` in `*_test.rs`).
    pub fn ensure_dir(path: impl AsRef<Path>) -> Result<(), String> {
        fs::create_dir_all(path.as_ref()).map_err(|e| e.to_string())
    }

    /// Write bytes to a path, creating parent directories as needed.
    pub fn write_path(path: impl AsRef<Path>, content: impl AsRef<[u8]>) -> Result<(), String> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            Self::ensure_dir(parent)?;
        }
        fs::write(path, content.as_ref()).map_err(|e| e.to_string())
    }

    /// Rename a file or directory (avoids `fs::rename` in `*_test.rs`).
    pub fn rename_path(from: impl AsRef<Path>, to: impl AsRef<Path>) -> Result<(), String> {
        fs::rename(from.as_ref(), to.as_ref()).map_err(|e| e.to_string())
    }

    /// Set a file's modification time to `now - delta` (for age-based cleanup tests).
    pub fn set_file_modified_back(
        path: impl AsRef<Path>,
        delta: std::time::Duration,
    ) -> Result<(), String> {
        use std::fs::OpenOptions;
        use std::time::SystemTime;
        let file = OpenOptions::new()
            .write(true)
            .open(path.as_ref())
            .map_err(|e| e.to_string())?;
        let when = SystemTime::now()
            .checked_sub(delta)
            .ok_or_else(|| "clock cannot go that far back".to_string())?;
        file.set_modified(when).map_err(|e| e.to_string())
    }

    /// Copy a file (avoids `fs::copy` in `*_test.rs`).
    pub fn copy_path(from: impl AsRef<Path>, to: impl AsRef<Path>) -> Result<(), String> {
        fs::copy(from.as_ref(), to.as_ref())
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Append to a file inside a workspace path.
    pub fn append_workspace_file(
        workspace_path: &str,
        relative_path: &str,
        content: &str,
    ) -> Result<PathBuf, String> {
        let file_path = Path::new(workspace_path).join(relative_path);
        Self::write_file_at_path(file_path.clone(), content, true)?;
        Ok(file_path)
    }

    /// Create a commit with a file change.
    pub fn commit_file(
        &self,
        relative_path: &str,
        content: &str,
        message: &str,
    ) -> Result<(), String> {
        self.create_file(relative_path, content)?;
        Self::run_git(&self.repo_path, &["add", relative_path])?;
        Self::run_git(&self.repo_path, &["commit", "-m", message])?;
        Ok(())
    }

    /// Write a file in a workspace and create a commit with the given message.
    pub fn commit_workspace_file(
        &self,
        workspace: &treq_lib::local_db::Workspace,
        relative_path: &str,
        content: &str,
        message: &str,
    ) -> Result<(), String> {
        let workspace_path = self.workspaces_dir().join(&workspace.workspace_path);
        let workspace_path_str = workspace_path
            .to_str()
            .ok_or_else(|| format!("workspace path is not utf-8: {}", workspace_path.display()))?;
        Self::write_workspace_file(workspace_path_str, relative_path, content)?;
        treq_lib::core::commit_workspace(&self.repo_path, workspace.id, message)?;
        Ok(())
    }

    /// Create a commit in the bare remote (requires with_remote()).
    /// Uses a temporary git clone of the remote to make the commit and push,
    /// so the local repo is never modified.
    pub fn remote_commit_file(
        &self,
        relative_path: &str,
        content: &str,
        message: &str,
    ) -> Result<(), String> {
        let remote_path = self.temp_dir.path().join("remote.git");
        let clone_path = self.temp_dir.path().join("remote_clone");

        // Clone the bare remote into a temporary working copy
        Self::run_git(
            &self.temp_dir.path().to_string_lossy(),
            &[
                "clone",
                remote_path.to_str().unwrap(),
                clone_path.to_str().unwrap(),
            ],
        )?;

        let clone_path_str = clone_path.to_string_lossy().to_string();

        // Configure git user in the clone
        Self::run_git(
            &clone_path_str,
            &["config", "user.email", "test@example.com"],
        )?;
        Self::run_git(&clone_path_str, &["config", "user.name", "Test User"])?;

        let default_branch = self.default_branch();
        if let Err(local_checkout_err) =
            Self::run_git(&clone_path_str, &["checkout", default_branch])
        {
            let remote_ref = format!("origin/{default_branch}");
            Self::run_git(
                &clone_path_str,
                &["checkout", "-b", default_branch, &remote_ref],
            )
            .map_err(|remote_checkout_err| {
                format!(
                    "Failed to checkout default branch '{}' in remote clone. Local checkout error: {} Fallback checkout from '{}' error: {}",
                    default_branch, local_checkout_err, remote_ref, remote_checkout_err
                )
            })?;
        }

        // Write file, commit, and push from the clone
        let file_path = clone_path.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
        }
        fs::write(&file_path, content)
            .map_err(|e| format!("Failed to write file in remote clone: {}", e))?;

        Self::run_git(&clone_path_str, &["add", relative_path])?;
        Self::run_git(&clone_path_str, &["commit", "-m", message])?;
        Self::run_git(&clone_path_str, &["push", "origin", self.default_branch()])?;

        // Clean up the clone
        fs::remove_dir_all(&clone_path)
            .map_err(|e| format!("Failed to clean up remote clone: {}", e))?;

        Ok(())
    }

    /// Push a branch to remote (requires with_remote()).
    pub fn push_branch(&self, branch_name: &str) -> Result<(), String> {
        Self::run_git(&self.repo_path, &["push", "origin", branch_name])?;
        Ok(())
    }

    /// Create a commit on a specific branch in the bare remote (requires with_remote()).
    /// Clones the remote to a temp dir, checks out the given branch, commits, and pushes back.
    /// The local repo is never modified — use jj_git_fetch after this to see the new remote commit.
    pub fn remote_commit_on_branch(
        &self,
        branch_name: &str,
        relative_path: &str,
        content: &str,
        message: &str,
    ) -> Result<(), String> {
        let remote_path = self.temp_dir.path().join("remote.git");
        let clone_path = self.temp_dir.path().join("remote_clone_branch");

        // Remove stale clone if it exists
        if clone_path.exists() {
            fs::remove_dir_all(&clone_path)
                .map_err(|e| format!("Failed to remove stale clone: {}", e))?;
        }

        // Clone the bare remote into a temporary working copy
        Self::run_git(
            &self.temp_dir.path().to_string_lossy(),
            &[
                "clone",
                remote_path.to_str().unwrap(),
                clone_path.to_str().unwrap(),
            ],
        )
        .expect("Failed to clone remote");

        let clone_path_str = clone_path.to_string_lossy().to_string();

        // Configure git user in the clone
        Self::run_git(
            &clone_path_str,
            &["config", "user.email", "test@example.com"],
        )
        .expect("Failed to configure git user email");
        Self::run_git(&clone_path_str, &["config", "user.name", "Test User"])
            .expect("Failed to configure git user name");

        // Checkout the target branch. In a fresh clone the branch may exist only as
        // origin/<branch>, so fall back to creating a local branch from that ref.
        if let Err(local_checkout_err) = Self::run_git(&clone_path_str, &["checkout", branch_name])
        {
            let remote_ref = format!("origin/{}", branch_name);
            if let Err(remote_checkout_err) = Self::run_git(
                &clone_path_str,
                &["checkout", "-b", branch_name, &remote_ref],
            ) {
                return Err(format!(
                    "Failed to checkout branch '{}' in remote clone. Local checkout error: {} Fallback checkout from '{}' error: {}",
                    branch_name, local_checkout_err, remote_ref, remote_checkout_err
                ));
            }
        }

        // Write file, commit, and push from the clone
        let file_path = clone_path.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
        }
        fs::write(&file_path, content)
            .map_err(|e| format!("Failed to write file in remote clone: {}", e))
            .expect("Failed to write file");

        Self::run_git(&clone_path_str, &["add", relative_path]).expect("Failed to add file");
        Self::run_git(&clone_path_str, &["commit", "-m", message]).expect("Failed to commit");
        Self::run_git(&clone_path_str, &["push", "origin", branch_name]).expect("Failed to push");

        // Clean up the clone
        fs::remove_dir_all(&clone_path)
            .map_err(|e| format!("Failed to clean up remote clone: {}", e))?;

        Ok(())
    }

    /// Get the path to the .treq directory.
    pub fn treq_dir(&self) -> PathBuf {
        Path::new(&self.repo_path).join(".treq")
    }

    /// Create and initialize a database for this repo.
    pub fn create_db(&self) -> Result<treq_lib::db::Database, String> {
        let treq_dir = self.treq_dir();
        std::fs::create_dir_all(&treq_dir)
            .map_err(|e| format!("Failed to create .treq dir: {}", e))?;
        let db_path = treq_dir.join("test.db");
        let db = treq_lib::db::Database::new(db_path)
            .map_err(|e| format!("Failed to create database: {}", e))?;
        db.init()
            .map_err(|e| format!("Failed to init database: {}", e))?;
        Ok(db)
    }

    /// Get the path to the workspaces directory.
    pub fn workspaces_dir(&self) -> PathBuf {
        self.treq_dir().join("workspaces")
    }

    /// Ensure the .treq/workspaces directory exists.
    /// Call this before creating workspaces.
    pub fn ensure_workspaces_dir(&self) -> Result<(), String> {
        let dir = self.workspaces_dir();
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create workspaces dir: {}", e))
    }

    /// Check if jj is initialized for this repo.
    pub fn is_jj_initialized(&self) -> bool {
        Path::new(&self.repo_path).join(".jj").exists()
    }

    /// Check if the local database exists.
    pub fn has_local_db(&self) -> bool {
        self.treq_dir().join("local.db").exists()
    }

    /// Get the contents of .gitignore.
    pub fn read_gitignore(&self) -> Result<String, String> {
        let gitignore_path = Path::new(&self.repo_path).join(".gitignore");
        if !gitignore_path.exists() {
            return Ok(String::new());
        }
        fs::read_to_string(&gitignore_path).map_err(|e| format!("Failed to read .gitignore: {}", e))
    }
}

#[allow(dead_code)]
pub fn create_test_repo(with_remote: bool) -> Result<TestRepo, String> {
    if with_remote {
        TestRepo::with_remote()
    } else {
        TestRepo::new()
    }
}

#[allow(dead_code)]
pub fn write_test_file(
    base_path: &str,
    relative_path: &str,
    content: &str,
    append: bool,
) -> Result<String, String> {
    let file_path = if append {
        TestRepo::append_workspace_file(base_path, relative_path, content)?
    } else {
        TestRepo::write_workspace_file(base_path, relative_path, content)?
    };
    Ok(file_path.to_string_lossy().to_string())
}

/// Helpers for verifying jj state
pub struct JjVerifier;

#[allow(dead_code)]
impl JjVerifier {
    /// Get the jj binary path, using treq's binary detection (same as jj.rs internals).
    fn jj_binary() -> String {
        treq_lib::binary_paths::detect_binary("jj").unwrap_or_else(|| "jj".to_string())
    }

    /// Get list of jj workspaces via `jj workspace list`
    pub fn list_workspaces(repo_path: &str) -> Result<Vec<String>, String> {
        let output = Command::new(Self::jj_binary())
            .current_dir(repo_path)
            .args(["workspace", "list"])
            .output()
            .map_err(|e| format!("Failed to execute jj workspace list: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "jj workspace list failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let workspaces: Vec<String> = stdout
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return None;
                }
                // Format: "workspace_name: commit_id description"
                trimmed.split(':').next().map(|s| s.trim().to_string())
            })
            .collect();

        Ok(workspaces)
    }

    /// Get jj log output for a workspace
    pub fn get_log(workspace_path: &str, limit: usize) -> Result<String, String> {
        let output = Command::new(Self::jj_binary())
            .current_dir(workspace_path)
            .args(["log", "-n", &limit.to_string(), "--no-graph"])
            .output()
            .map_err(|e| format!("Failed to execute jj log: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "jj log failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Resolve a revset to a single commit id.
    pub fn get_commit_id_for_rev(
        workspace_path: &str,
        rev: &str,
    ) -> Result<Option<String>, String> {
        let output = Command::new(Self::jj_binary())
            .current_dir(workspace_path)
            .args(["log", "-r", rev, "-n", "1", "--no-graph", "-T", "commit_id"])
            .output()
            .map_err(|e| format!("Failed to execute jj log: {}", e))?;

        if !output.status.success() {
            return Ok(None);
        }

        let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if id.is_empty() {
            Ok(None)
        } else {
            Ok(Some(id))
        }
    }

    /// Get jj log output for a workspace
    pub fn get_log_previous_commit(workspace_path: &str) -> Result<String, String> {
        let output = Command::new(Self::jj_binary())
            .current_dir(workspace_path)
            .args(["log", "-n", "1", "--no-graph", "-r", "@-"])
            .output()
            .map_err(|e| format!("Failed to execute jj log: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "jj log failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
    /// Get current bookmark (branch) for a workspace
    pub fn get_current_bookmark(workspace_path: &str) -> Result<Option<String>, String> {
        let output = Command::new(Self::jj_binary())
            .current_dir(workspace_path)
            .args(["bookmark", "list", "--all"])
            .output()
            .map_err(|e| format!("Failed to execute jj bookmark list: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "jj bookmark list failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        // Find bookmark pointing to @ (current working copy)
        for line in stdout.lines() {
            if line.contains("@") && !line.contains("@origin") {
                // Extract bookmark name (first word before colon)
                if let Some(name) = line.split(':').next() {
                    let name = name.trim().trim_start_matches('*').trim();
                    if !name.is_empty() {
                        return Ok(Some(name.to_string()));
                    }
                }
            }
        }

        Ok(None)
    }

    /// Get list of all bookmarks in workspace
    pub fn list_bookmarks(repo_path: &str) -> Result<Vec<String>, String> {
        let output = Command::new(Self::jj_binary())
            .current_dir(repo_path)
            .args(["bookmark", "list", "--all"])
            .output()
            .map_err(|e| format!("Failed to execute jj bookmark list: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "jj bookmark list failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let bookmarks: Vec<String> = stdout
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return None;
                }
                // Extract bookmark name (before colon, strip leading *)
                trimmed
                    .split(':')
                    .next()
                    .map(|s| s.trim().trim_start_matches('*').trim().to_string())
            })
            .filter(|s| !s.is_empty() && !s.contains('@'))
            .collect();

        Ok(bookmarks)
    }

    /// Return the commit id the bookmark currently points to, or None if the bookmark doesn't resolve.
    pub fn get_bookmark_commit_id(
        repo_path: &str,
        bookmark: &str,
    ) -> Result<Option<String>, String> {
        let output = Command::new(Self::jj_binary())
            .current_dir(repo_path)
            .args([
                "log",
                "-r",
                bookmark,
                "-n",
                "1",
                "--no-graph",
                "-T",
                "commit_id",
            ])
            .output()
            .map_err(|e| format!("Failed to execute jj log: {}", e))?;

        if !output.status.success() {
            return Ok(None);
        }

        let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if id.is_empty() {
            Ok(None)
        } else {
            Ok(Some(id))
        }
    }

    /// Check if jj working copy has changes (is dirty)
    pub fn has_changes(workspace_path: &str) -> Result<bool, String> {
        let output = Command::new(Self::jj_binary())
            .current_dir(workspace_path)
            .args(["diff", "--stat"])
            .output()
            .map_err(|e| format!("Failed to execute jj diff: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "jj diff failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(!stdout.trim().is_empty())
    }

    /// Get jj status output
    pub fn get_status(workspace_path: &str) -> Result<String, String> {
        let output = Command::new(Self::jj_binary())
            .current_dir(workspace_path)
            .args(["status"])
            .output()
            .map_err(|e| format!("Failed to execute jj status: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "jj status failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Check if a file exists in the jj working copy
    pub fn file_exists_in_workspace(workspace_path: &str, file_path: &str) -> bool {
        Path::new(workspace_path).join(file_path).exists()
    }

    /// Get the parent commit of the current working copy
    pub fn get_parent_info(workspace_path: &str) -> Result<String, String> {
        let output = Command::new(Self::jj_binary())
            .current_dir(workspace_path)
            .args([
                "log",
                "-r",
                "@-",
                "-n",
                "1",
                "--no-graph",
                "-T",
                "description",
            ])
            .output()
            .map_err(|e| format!("Failed to execute jj log: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "jj log failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    /// Verify workspace is properly initialized
    /// jj workspaces may have different structure than git worktrees
    pub fn verify_workspace_structure(workspace_path: &str) -> Result<(), String> {
        let path = Path::new(workspace_path);

        // Check workspace directory exists
        if !path.exists() {
            return Err(format!("Workspace directory not found: {}", workspace_path));
        }

        if !path.is_dir() {
            return Err(format!(
                "Workspace path is not a directory: {}",
                workspace_path
            ));
        }

        // jj workspaces might have .git file/dir or be jj-native
        // Check for either .git or verify jj recognizes this as a workspace
        let git_path = path.join(".git");
        let has_git = git_path.exists();

        // Try running jj status to verify it's a valid jj workspace
        let jj_works = Command::new(Self::jj_binary())
            .current_dir(workspace_path)
            .args(["status"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !has_git && !jj_works {
            return Err(format!(
                "Workspace is not a valid git/jj workspace: {}",
                workspace_path
            ));
        }

        Ok(())
    }
}
