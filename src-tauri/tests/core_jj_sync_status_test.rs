mod e2e_test_helpers;

use e2e_test_helpers::TestRepo;
use std::process::Command;
use treq_lib::core::{workspace_status, RemoteSyncStatus};
use treq_lib::jj;

fn run_git(repo_path: &str, args: &[&str]) {
    TestRepo::run_git(repo_path, args)
        .unwrap_or_else(|error| panic!("git command failed: {:?}\n{}", args, error));
}

fn setup_workspace_with_remote() -> (TestRepo, treq_lib::local_db::Workspace, String) {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/sync-it",
        Some("sync status integration test".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().unwrap().to_string();

    TestRepo::write_workspace_file(&workspace_path_str, "initial.txt", "initial content\n")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Initial commit")
        .expect("Failed to commit");
    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("Failed to push");

    (repo, workspace, workspace_path_str)
}

#[test]
fn test_workspace_sync_status_local_only_single_commit_integration() {
    let (repo, workspace, workspace_path_str) = setup_workspace_with_remote();

    TestRepo::write_workspace_file(&workspace_path_str, "local-1.txt", "local content\n")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Local commit 1")
        .expect("Failed to commit");

    let status = workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");
    assert_eq!(
        status.remote_sync,
        RemoteSyncStatus::Ahead { count: 1 },
        "expected one commit ahead of remote, got {:?}",
        status.remote_sync
    );
}

#[test]
fn test_workspace_sync_status_local_only_multiple_commits_integration() {
    let (repo, workspace, workspace_path_str) = setup_workspace_with_remote();

    TestRepo::write_workspace_file(&workspace_path_str, "local-1.txt", "local content 1\n")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Local commit 1")
        .expect("Failed to commit");

    TestRepo::write_workspace_file(&workspace_path_str, "local-2.txt", "local content 2\n")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Local commit 2")
        .expect("Failed to commit");

    let status = workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");
    assert_eq!(
        status.remote_sync,
        RemoteSyncStatus::Ahead { count: 2 },
        "expected two commits ahead of remote, got {:?}",
        status.remote_sync
    );
}

#[test]
fn test_workspace_sync_status_true_divergence_integration() {
    let (repo, workspace, workspace_path_str) = setup_workspace_with_remote();
    let branch_name = workspace.branch_name.clone();

    TestRepo::write_workspace_file(&workspace_path_str, "local-1.txt", "local content\n")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Local commit 1")
        .expect("Failed to commit");

    let clone_dir = repo.temp_dir.path().join("clone-sync-div");
    let clone_path_str = clone_dir.to_str().unwrap();
    let remote_dir = repo.temp_dir.path().join("remote.git");

    run_git(
        repo.temp_dir.path().to_str().unwrap(),
        &["clone", remote_dir.to_str().unwrap(), clone_path_str],
    );
    run_git(clone_path_str, &["config", "user.name", "Treq Test"]);
    run_git(
        clone_path_str,
        &["config", "user.email", "treq-test@example.com"],
    );
    run_git(clone_path_str, &["checkout", &branch_name]);
    TestRepo::write_workspace_file(clone_path_str, "remote-1.txt", "remote content\n")
        .expect("Failed to write remote file");
    run_git(clone_path_str, &["add", "remote-1.txt"]);
    run_git(clone_path_str, &["commit", "-m", "Remote commit"]);
    run_git(clone_path_str, &["push", "origin", &branch_name]);

    treq_lib::core::pull_workspace_from_remote(&repo.repo_path, None, "git")
        .expect("fetch should succeed");

    let status = workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");
    assert_eq!(
        status.remote_sync,
        RemoteSyncStatus::Diverged {
            ahead: 1,
            behind: 1
        },
        "expected diverged sync status, got {:?}",
        status.remote_sync
    );
}

#[test]
fn test_workspace_status_not_on_remote() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/not-on-remote",
        Some("test not on remote".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    assert!(
        workspace.not_on_remote,
        "New workspace should be not_on_remote"
    );

    let status = workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");

    assert_eq!(
        status.remote_sync,
        RemoteSyncStatus::NotOnRemote,
        "Unpushed workspace should have NotOnRemote sync status"
    );
}

#[test]
fn test_workspace_status_behind_remote() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/behind",
        Some("test behind".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().unwrap();

    // Add initial commit and push
    TestRepo::write_workspace_file(workspace_path_str, "file1.txt", "content 1")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Initial commit")
        .expect("Failed to commit");
    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("Failed to push workspace");

    repo.remote_commit_on_branch(
        &workspace.branch_name,
        "remote-file.txt",
        "from remote",
        "Remote commit",
    )
    .expect("Failed to create remote commit");

    // Fetch in the main repo so jj knows about the remote commit.
    // Note: jj auto-fast-forwards the local bookmark to match remote on fetch.
    jj::jj_git_fetch(&repo.repo_path).expect("Failed to fetch");

    // Move the local bookmark back to simulate being behind remote.
    // After fetch, both local and remote point to the same commit.
    // Setting the bookmark to its parent puts local one commit behind remote.
    let set_output = Command::new("jj")
        .current_dir(workspace_path_str)
        .args([
            "bookmark",
            "set",
            &workspace.branch_name,
            "-r",
            &format!("{}@origin-", workspace.branch_name),
            "--allow-backwards",
        ])
        .output()
        .expect("Failed to set bookmark");
    assert!(
        set_output.status.success(),
        "Failed to set bookmark back: {}",
        String::from_utf8_lossy(&set_output.stderr)
    );

    let status = workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");

    assert_eq!(
        status.remote_sync,
        RemoteSyncStatus::Behind { count: 1 },
        "Workspace should be Behind {{ count: 1 }} after remote commit"
    );
}

#[test]
fn test_jj_get_sync_status_returns_to_sync_after_push() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/sync-push",
        Some("sync status push test".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().unwrap();

    // Establish remote branch
    TestRepo::write_workspace_file(workspace_path_str, "initial.txt", "initial content\n")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Initial commit on branch")
        .expect("Failed to commit");
    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("Failed to push");
    treq_lib::core::pull_workspace_from_remote(&repo.repo_path, Some(workspace.id), "git")
        .expect("Failed to pull");

    let branch_before = jj::get_workspace_branch(workspace_path_str)
        .expect("Failed to get git branch before local commit");

    // Make a local commit then push it
    TestRepo::write_workspace_file(workspace_path_str, "local_only.txt", "local content\n")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Local only commit")
        .expect("Failed to commit");
    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("Failed to push");
    treq_lib::core::pull_workspace_from_remote(&repo.repo_path, Some(workspace.id), "git")
        .expect("Failed to pull after push");

    // Verify branch is unchanged after push+pull
    let branch_after = jj::get_workspace_branch(workspace_path_str)
        .expect("Failed to get git branch after push+pull");
    assert_eq!(
        branch_after, branch_before,
        "Git branch should not change after push+pull, was '{}' now '{}'",
        branch_before, branch_after
    );

    // Verify workspace_status shows InSync
    let status = workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");
    assert_eq!(
        status.remote_sync,
        RemoteSyncStatus::InSync,
        "workspace_status should show InSync after push+pull, got {:?}",
        status.remote_sync
    );

    // Should be back in sync (0, 0)
    let (ahead, behind) = jj::jj_get_sync_status(workspace_path_str, &workspace.branch_name, false)
        .expect("Failed to get sync status after push");
    assert_eq!(
        (ahead, behind),
        (0, 0),
        "After push+fetch, should be in sync (0, 0), got ({}, {})",
        ahead,
        behind
    );
}
