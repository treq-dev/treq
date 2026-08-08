mod e2e_test_helpers;

use e2e_test_helpers::{JjVerifier, TestRepo};
use std::path::Path;
use std::process::Command;

use treq_lib::core::{MaybeEmptyParam, MergeCommit, RemoteSyncStatus};
use treq_lib::jj;
use treq_lib::local_db::Workspace;

/// Create a workspace and set its target branch. Helper shared across rebase tests.
fn setup_workspace_with_target(
    repo: &TestRepo,
    branch: &str,
    target: &str,
) -> treq_lib::local_db::Workspace {
    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        branch,
        Some(format!("test workspace for {}", branch)),
        None,
        None,
        None,
        None,
    )
    .unwrap_or_else(|e| panic!("Failed to create workspace '{}': {}", branch, e));

    treq_lib::local_db::update_workspace_target_branch(&repo.repo_path, workspace.id, target)
        .unwrap_or_else(|e| panic!("Failed to set target branch: {}", e));

    treq_lib::local_db::get_workspace_by_id(&repo.repo_path, workspace.id)
        .expect("db lookup should succeed")
        .expect("workspace should exist after creation")
}

fn setup_workspace_with_source(
    repo: &TestRepo,
    branch: &str,
    source_branch: &str,
) -> treq_lib::local_db::Workspace {
    treq_lib::core::create_workspace(
        &repo.repo_path,
        branch,
        Some(format!("test workspace for {}", branch)),
        None,
        Some(source_branch),
        None,
        None,
    )
    .unwrap_or_else(|e| panic!("Failed to create workspace '{}': {}", branch, e))
}

#[test]
fn test_check_and_rebase_workspaces_all_succeeds() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let default_branch = repo.default_branch();
    let _ws = setup_workspace_with_target(&repo, "feat/rebase-all", default_branch);

    let result =
        treq_lib::core::check_and_rebase_workspaces(&repo.repo_path, None, None, None, "git")
            .expect("check_and_rebase_workspaces should not error");

    assert!(
        result.success,
        "rebase should succeed, message: {}",
        result.message
    );
    assert!(
        result.bookmark_conflicts.is_empty(),
        "no bookmark conflicts expected"
    );
}

#[test]
fn test_check_and_rebase_workspaces_single_workspace() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let default_branch = repo.default_branch();
    let ws = setup_workspace_with_target(&repo, "feat/single-rebase", default_branch);

    let result = treq_lib::core::check_and_rebase_workspaces(
        &repo.repo_path,
        Some(ws.id),
        Some(default_branch.to_string()),
        None,
        "git",
    )
    .expect("single-workspace rebase should not error");

    assert!(
        result.success,
        "single rebase should succeed, message: {}",
        result.message
    );
}

#[test]
fn test_check_and_rebase_workspaces_force_bypasses_up_to_date() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let default_branch = repo.default_branch();
    let ws = setup_workspace_with_target(&repo, "feat/force-rebase", default_branch);

    // First call: marks workspace as up-to-date (last_rebased_commit = current main).
    treq_lib::core::check_and_rebase_workspaces(
        &repo.repo_path,
        Some(ws.id),
        Some(default_branch.to_string()),
        None,
        "git",
    )
    .expect("first rebase should succeed");

    // Second call with force=true: should rebase even though nothing changed.
    let result = treq_lib::core::check_and_rebase_workspaces(
        &repo.repo_path,
        Some(ws.id),
        Some(default_branch.to_string()),
        Some(true),
        "git",
    )
    .expect("forced rebase should not error");

    assert!(
        result.rebased,
        "force=true should trigger rebase even when already up-to-date"
    );
    assert!(result.success, "forced rebase should succeed");
}

#[test]
fn test_force_rebase_workspace_uses_rooted_subtree_scope_excluding_root() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let default_branch = repo.default_branch();
    let ws_a = setup_workspace_with_target(&repo, "feat/root-a", default_branch);
    let ws_b = setup_workspace_with_source(&repo, "feat/child-b", "feat/root-a");
    let ws_c = setup_workspace_with_source(&repo, "feat/grandchild-c", "feat/child-b");
    let ws_d = setup_workspace_with_source(&repo, "feat/sibling-d", "feat/root-a");

    let result = treq_lib::core::check_and_rebase_workspaces(
        &repo.repo_path,
        Some(ws_b.id),
        Some(default_branch.to_string()),
        Some(true),
        "git",
    )
    .expect("forced rooted-subtree rebase should not error");

    assert!(result.success, "forced rooted-subtree should succeed");
    assert!(
        result.message.contains("Skipped root workspace"),
        "root workspace should be skipped: {}",
        result.message
    );
    assert!(
        result.message.contains("feat-child-b")
            && result.message.contains("feat-grandchild-c")
            && result.message.contains("feat-sibling-d"),
        "descendants/siblings should be included: {}",
        result.message
    );
    assert!(
        result.message.contains("wc refresh deferred"),
        "force rooted-subtree should report deferred working-copy refresh: {}",
        result.message
    );

    let a_last = treq_lib::local_db::get_workspace_last_rebased_commit(&repo.repo_path, ws_a.id)
        .ok()
        .flatten()
        .unwrap_or_default();
    let b_last = treq_lib::local_db::get_workspace_last_rebased_commit(&repo.repo_path, ws_b.id)
        .ok()
        .flatten()
        .unwrap_or_default();
    let c_last = treq_lib::local_db::get_workspace_last_rebased_commit(&repo.repo_path, ws_c.id)
        .ok()
        .flatten()
        .unwrap_or_default();
    let d_last = treq_lib::local_db::get_workspace_last_rebased_commit(&repo.repo_path, ws_d.id)
        .ok()
        .flatten()
        .unwrap_or_default();

    assert!(a_last.is_empty(), "root should not be rebased");
    assert!(!b_last.is_empty(), "child should be rebased");
    assert!(!c_last.is_empty(), "grandchild should be rebased");
    assert!(!d_last.is_empty(), "sibling should be rebased");
}

#[test]
fn test_check_and_rebase_workspaces_skips_self_rebase() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    // Set target_branch equal to branch_name — should be a no-op.
    let ws = setup_workspace_with_target(&repo, "feat/self-target", "feat/self-target");

    let result = treq_lib::core::check_and_rebase_workspaces(
        &repo.repo_path,
        Some(ws.id),
        Some("feat/self-target".to_string()),
        None,
        "git",
    )
    .expect("self-rebase call should not error");

    assert!(
        !result.rebased,
        "self-rebase (branch_name == target_branch) should be skipped"
    );
    assert!(
        result.success,
        "skipped self-rebase should still report success"
    );
}

#[test]
fn test_check_and_rebase_workspaces_all_skips_self_rebase() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    // All workspaces target their own branch → nothing to rebase.
    let _ws = setup_workspace_with_target(&repo, "feat/self-all", "feat/self-all");

    let result =
        treq_lib::core::check_and_rebase_workspaces(&repo.repo_path, None, None, None, "git")
            .expect("check_and_rebase_all with only self-targeting workspaces should not error");

    assert!(
        !result.rebased,
        "all-rebase should skip workspaces where branch_name == target_branch"
    );
    assert!(result.success);
}

#[test]
fn test_can_update_workspace() {
    let repo = TestRepo::new().expect("Failed to create test repo");

    let workspace: Workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/update-test",
        Some("initial feature".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let updated = treq_lib::core::update_workspace(
        &repo.repo_path,
        workspace.id,
        MaybeEmptyParam::Omitted,
        MaybeEmptyParam::Some("develop different feature".to_string()),
    )
    .expect("Failed to update workspace");

    // correctly updates description
    assert_eq!(
        updated.description,
        Some("develop different feature".to_string()),
        "Workspace description should be updated"
    );
    assert_eq!(
        updated.branch_name, workspace.branch_name,
        "Workspace branch name should remain unchanged after update"
    );
}

#[test]
fn test_update_workspace_target_branch_perform_rebase() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let default_branch = repo.default_branch();

    // base is
    let workspace: Workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/initial",
        Some("initial feature".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    // create the develop branch
    TestRepo::run_git(&repo.repo_path, &["checkout", "-b", "develop"][..])
        .expect("Failed to create develop branch");

    // add a commit to the develop branch
    repo.commit_file("develop.txt", "develop content", "Develop commit")
        .expect("Failed to commit");

    // check out main branch on the home repo

    TestRepo::run_git(&repo.repo_path, &["checkout", default_branch][..])
        .expect("Failed to checkout main");

    // change the target branch of the workspace to the develop branch
    let updated = treq_lib::core::update_workspace(
        &repo.repo_path,
        workspace.id,
        MaybeEmptyParam::Some("develop".to_string()),
        MaybeEmptyParam::Omitted,
    )
    .expect("Failed to update workspace");

    assert_eq!(
        updated.target_branch,
        Some("develop".to_string()),
        "Workspace target branch should be updated to develop"
    );
    assert_eq!(
        updated.branch_name,
        "feat/initial".to_string(),
        "Workspace branch name should remain unchanged after update"
    );
    assert_eq!(
        updated.description,
        Some("initial feature".to_string()),
        "Workspace description should remain unchanged from creation"
    );

    // verify that the workspace is rebased onto the develop branch, check that develop.txt is present in workspace
    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let develop_file_path = workspace_path.join("develop.txt");
    assert!(
        develop_file_path.exists(),
        "develop.txt should exist in workspace after rebase"
    );

    // verify jj that Develop commit is in jj log
    let log = JjVerifier::get_log_previous_commit(&workspace_path.to_str().unwrap())
        .expect("Failed to get jj log");
    assert!(
        log.contains("Develop commit"),
        "JJ log should contain develop commit, got: {}",
        log
    );
}

#[test]
fn test_update_workspace_target_branch_rebases_workspace_bookmark_lineage() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let default_branch = repo.default_branch();

    let workspace: Workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/bookmark-rebase",
        Some("bookmark rebase test".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path
        .to_str()
        .expect("workspace path should be utf-8");

    TestRepo::write_workspace_file(workspace_path_str, "feature.txt", "feature work\n")
        .expect("Failed to write workspace file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Workspace feature commit")
        .expect("Failed to create workspace commit");
    let new_wc_output = Command::new("jj")
        .current_dir(workspace_path_str)
        .args(["new"])
        .output()
        .expect("Failed to run jj new");
    assert!(
        new_wc_output.status.success(),
        "jj new should create an empty workspace commit: {}",
        String::from_utf8_lossy(&new_wc_output.stderr)
    );

    TestRepo::run_git(&repo.repo_path, &["checkout", "-b", "develop"][..])
        .expect("Failed to create develop branch");
    repo.commit_file("develop.txt", "develop content", "Develop base commit")
        .expect("Failed to commit develop branch");
    let develop_tip = TestRepo::run_git(&repo.repo_path, &["rev-parse", "develop"][..])
        .expect("Failed to read develop tip")
        .trim()
        .to_string();
    TestRepo::run_git(&repo.repo_path, &["checkout", default_branch][..])
        .expect("Failed to checkout main");

    let updated = treq_lib::core::update_workspace(
        &repo.repo_path,
        workspace.id,
        MaybeEmptyParam::Some("develop".to_string()),
        MaybeEmptyParam::Omitted,
    )
    .expect("Failed to update workspace target branch");
    assert_eq!(updated.target_branch.as_deref(), Some("develop"));

    let output = Command::new("jj")
        .current_dir(&repo.repo_path)
        .args([
            "log",
            "-r",
            &format!("ancestors({}) & {}", workspace.branch_name, develop_tip),
            "-n",
            "1",
            "--no-graph",
            "-T",
            "commit_id",
        ])
        .output()
        .expect("Failed to run jj log");
    assert!(
        output.status.success(),
        "jj log should succeed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let overlap = String::from_utf8_lossy(&output.stdout).trim().to_string();
    assert!(
        !overlap.is_empty(),
        "workspace bookmark lineage should include develop tip after rebase; stdout={}",
        String::from_utf8_lossy(&output.stdout)
    );
}

#[test]
fn test_can_list_workspaces() {
    let repo = TestRepo::new().expect("Failed to create test repo");

    treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/a",
        Some("feature-a".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");
    treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/b",
        Some("feature-b".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");
    treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/c",
        Some("feature-c".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    // JJ VERIFICATION: Verify via jj workspace list command directly (primary source of truth)
    let jj_workspaces =
        JjVerifier::list_workspaces(&repo.repo_path).expect("Failed to list jj workspaces");

    // Should have default + 3 created workspaces
    assert_eq!(
        jj_workspaces.len(),
        4,
        "jj should list 4 workspaces, got {}",
        jj_workspaces.len()
    );
    let workspaces =
        treq_lib::core::list_workspaces(&repo.repo_path).expect("Failed to list workspaces");
    assert_eq!(
        workspaces.len(),
        3,
        "Should have 3 workspaces, got {}",
        workspaces.len()
    );
}

#[test]
fn test_push_workspace_to_remote() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    // Test 1: Invalid workspace_id fails
    let result = treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(99999));
    assert!(
        result.is_err(),
        "Push with invalid workspace_id should fail"
    );
    assert!(
        result.unwrap_err().to_lowercase().contains("not found"),
        "Error should indicate workspace not found"
    );

    // Test 2: Create workspace and verify it's marked as not_on_remote
    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "test-workspace",
        Some("test workspace".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    assert!(
        workspace.not_on_remote,
        "New workspace should be marked as not_on_remote"
    );

    // Test 3: Add a file and commit to the workspace
    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path
        .to_str()
        .expect("workspace path should be utf-8");
    TestRepo::write_workspace_file(workspace_path_str, "test-push.txt", "test push content")
        .expect("Failed to write test file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Add test push file")
        .expect("Failed to commit");

    // Test 4: Push workspace to remote (should succeed now)
    let result_push = treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id));
    assert!(
        result_push.is_ok(),
        "Push should succeed with proper remote setup, got: {:?}",
        result_push.err()
    );

    // Test 5: Verify file was pushed to remote by checking remote branch
    let remote_dir = repo.temp_dir.path().join("remote.git");
    let remote_dir_str = remote_dir.to_str().expect("remote path should be utf-8");
    let remote_ref = format!("{}:test-push.txt", workspace.branch_name);
    let remote_file_content = TestRepo::run_git(remote_dir_str, &["show", remote_ref.as_str()][..])
        .expect("File should exist in remote branch");
    assert!(
        remote_file_content.contains("test push content"),
        "Remote file should contain correct content, got: {}",
        remote_file_content
    );

    // Test 6: Verify not_on_remote flag was cleared after successful push
    let workspace_after_push =
        treq_lib::local_db::get_workspace_by_id(&repo.repo_path, workspace.id)
            .expect("Failed to get workspace from db")
            .expect("Workspace should exist after push");
    assert!(
        !workspace_after_push.not_on_remote,
        "not_on_remote flag should be cleared after successful push"
    );
}

#[test]
fn test_push_home_repo_to_remote() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    // Test 1: Create a workspace to verify home repo push doesn't affect workspace flags
    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "workspace-for-home-test",
        Some("test".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    assert!(
        workspace.not_on_remote,
        "Workspace should be marked as not_on_remote"
    );

    // Test 2: Test push home repo (None workspace_id) succeeds with remote setup
    let result_push = treq_lib::core::push_workspace_to_remote(&repo.repo_path, None);
    assert!(
        result_push.is_ok(),
        "Push home repo to remote should succeed with proper remote setup, got: {:?}",
        result_push.err()
    );

    // Test 3: Verify home repo push didn't affect workspace flags
    let workspace_after_push =
        treq_lib::local_db::get_workspace_by_id(&repo.repo_path, workspace.id)
            .expect("Failed to get workspace from db")
            .expect("Workspace should exist after push");

    assert!(
        workspace_after_push.not_on_remote,
        "Workspace not_on_remote flag should NOT be modified by home repo push"
    );
}

#[test]
fn test_rename_workspace_dry_run_valid_name() {
    let repo = TestRepo::new().expect("Failed to create test repo");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/original",
        Some("original feature".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    // Dry run should succeed with a valid new name
    let result =
        treq_lib::core::rename_workspace(&repo.repo_path, workspace.id, "feat/new-name", true)
            .expect("Failed to dry-run rename workspace");

    assert!(result.success, "Dry run should succeed for valid name");

    // Verify workspace is unchanged in DB
    let db_workspace = treq_lib::local_db::get_workspace_by_id(&repo.repo_path, workspace.id)
        .expect("Failed to get workspace")
        .expect("Workspace should exist");
    assert_eq!(
        db_workspace.branch_name, "feat/original",
        "Branch name should be unchanged after dry run"
    );

    // Verify jj bookmarks are unchanged
    let bookmarks = JjVerifier::list_bookmarks(&repo.repo_path).expect("Failed to list bookmarks");
    assert!(
        bookmarks.iter().any(|b| b == "feat/original"),
        "Original bookmark should still exist after dry run, got: {:?}",
        bookmarks
    );
    assert!(
        !bookmarks.iter().any(|b| b == "feat/new-name"),
        "New bookmark should NOT exist after dry run, got: {:?}",
        bookmarks
    );
}

#[test]
fn test_rename_workspace_dry_run_clashes_with_existing_branch() {
    let repo = TestRepo::new().expect("Failed to create test repo");

    let _ws_a = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/a",
        Some("feature a".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace A");

    let ws_b = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/b",
        Some("feature b".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace B");

    // Try to rename B to A's branch name (should fail)
    let result = treq_lib::core::rename_workspace(&repo.repo_path, ws_b.id, "feat/a", true)
        .expect("Failed to dry-run rename workspace");

    assert!(
        !result.success,
        "Dry run should fail when name clashes with existing branch"
    );
    assert!(
        result.message.to_lowercase().contains("already exists")
            || result.message.to_lowercase().contains("clash"),
        "Message should indicate branch already exists, got: {}",
        result.message
    );
}

#[test]
fn test_rename_workspace_dry_run_same_name() {
    let repo = TestRepo::new().expect("Failed to create test repo");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/original",
        Some("original feature".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    // Renaming to same name should fail
    let result =
        treq_lib::core::rename_workspace(&repo.repo_path, workspace.id, "feat/original", true)
            .expect("Failed to dry-run rename workspace");

    assert!(
        !result.success,
        "Dry run should fail when renaming to the same name"
    );
}

#[test]
fn test_rename_workspace_success() {
    let repo = TestRepo::new().expect("Failed to create test repo");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/original",
        Some("original feature".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    // Actual rename
    let result =
        treq_lib::core::rename_workspace(&repo.repo_path, workspace.id, "feat/renamed", false)
            .expect("Failed to rename workspace");

    assert!(result.success, "Rename should succeed");
    assert_eq!(
        result.workspace.as_ref().unwrap().branch_name,
        "feat/renamed",
        "Result workspace should have new branch name"
    );

    // Verify DB is updated
    let db_workspace = treq_lib::local_db::get_workspace_by_id(&repo.repo_path, workspace.id)
        .expect("Failed to get workspace")
        .expect("Workspace should exist");
    assert_eq!(
        db_workspace.branch_name, "feat/renamed",
        "DB branch name should be updated"
    );

    // Verify jj bookmarks
    let bookmarks = JjVerifier::list_bookmarks(&repo.repo_path).expect("Failed to list bookmarks");
    assert!(
        bookmarks.iter().any(|b| b == "feat/renamed"),
        "New bookmark should exist, got: {:?}",
        bookmarks
    );
    assert!(
        !bookmarks.iter().any(|b| b == "feat/original"),
        "Old bookmark should NOT exist, got: {:?}",
        bookmarks
    );
}

#[test]
fn test_rename_workspace_updates_child_target_branches() {
    let repo = TestRepo::new().expect("Failed to create test repo");

    // Create parent workspace
    let parent = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/parent",
        Some("parent feature".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create parent workspace");

    // Create stacked workspace targeting parent
    let child = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/child",
        None,
        None,
        Some(&parent.branch_name),
        None,
        None,
    )
    .expect("Failed to create child workspace");

    // Verify child targets parent
    assert_eq!(
        child.target_branch.as_deref(),
        Some("feat/parent"),
        "Child should target parent"
    );

    // Rename parent
    let result =
        treq_lib::core::rename_workspace(&repo.repo_path, parent.id, "feat/parent-renamed", false)
            .expect("Failed to rename parent workspace");

    assert!(result.success, "Rename should succeed");
    assert!(
        result.updated_children_ids.contains(&child.id),
        "Child should be in updated_children_ids, got: {:?}",
        result.updated_children_ids
    );

    // Verify child's target_branch is updated
    let updated_child = treq_lib::local_db::get_workspace_by_id(&repo.repo_path, child.id)
        .expect("Failed to get child workspace")
        .expect("Child workspace should exist");
    assert_eq!(
        updated_child.target_branch.as_deref(),
        Some("feat/parent-renamed"),
        "Child's target_branch should be updated to new name"
    );
}

#[test]
fn test_rename_workspace_sets_not_on_remote() {
    let repo = TestRepo::new().expect("Failed to create test repo");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/original",
        Some("original feature".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    // Rename workspace
    let result =
        treq_lib::core::rename_workspace(&repo.repo_path, workspace.id, "feat/renamed", false)
            .expect("Failed to rename workspace");

    assert!(result.success, "Rename should succeed");

    // Verify not_on_remote is set to true
    let db_workspace = treq_lib::local_db::get_workspace_by_id(&repo.repo_path, workspace.id)
        .expect("Failed to get workspace")
        .expect("Workspace should exist");
    assert!(
        db_workspace.not_on_remote,
        "not_on_remote should be true after rename"
    );
}

#[test]
fn test_sync_workspaces_forget_deleted_directories() {
    let repo = TestRepo::new().expect("Failed to create test repo");

    // Create workspace
    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/test-recover",
        Some("recovery test".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);

    TestRepo::remove_dir_all_path(&workspace_path).expect("Failed to delete workspace directory");

    treq_lib::core::sync_workspaces(&repo.repo_path).expect("Failed to sync workspaces");

    let workspaces =
        treq_lib::core::list_workspaces(&repo.repo_path).expect("Failed to list workspaces");
    assert!(workspaces.is_empty(), "Workspaces should be empty");

    assert!(
        !workspace_path.exists(),
        "Workspace directory should stay deleted"
    );

    let jj_workspaces =
        JjVerifier::list_workspaces(&repo.repo_path).expect("Failed to list jj workspaces");
    assert!(
        !jj_workspaces.contains(&workspace.workspace_name),
        "jj workspace list should not contain '{}', got: {:?}",
        workspace.workspace_name,
        jj_workspaces
    );
    assert_eq!(
        jj_workspaces.len(),
        1,
        "jj should only list the default workspace after sync forgets the deleted directory, got: {:?}",
        jj_workspaces
    );
    assert!(
        jj_workspaces.contains(&"default".to_string()),
        "jj workspace list should still include default, got: {:?}",
        jj_workspaces
    );
}

#[test]
fn test_sync_workspaces_delete_forgotten_directories() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/test-forgotten",
        Some("forgotten test".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);

    let forget_output = Command::new("jj")
        .current_dir(&repo.repo_path)
        .args(["workspace", "forget", workspace.workspace_name.as_str()])
        .output()
        .expect("Failed to execute jj workspace forget");
    assert!(
        forget_output.status.success(),
        "jj workspace forget should succeed: {}",
        String::from_utf8_lossy(&forget_output.stderr)
    );

    treq_lib::core::sync_workspaces(&repo.repo_path).expect("Failed to sync workspaces");
    let workspaces =
        treq_lib::core::list_workspaces(&repo.repo_path).expect("Failed to list workspaces");
    assert!(workspaces.is_empty(), "Workspaces should be empty");

    assert!(
        !workspace_path.exists(),
        "Workspace directory should stay deleted"
    );

    let jj_workspaces =
        JjVerifier::list_workspaces(&repo.repo_path).expect("Failed to list jj workspaces");
    assert!(
        !jj_workspaces.contains(&workspace.workspace_name),
        "jj workspace list should not contain '{}', got: {:?}",
        workspace.workspace_name,
        jj_workspaces
    );
    assert_eq!(
        jj_workspaces.len(),
        1,
        "jj should only list the default workspace, got: {:?}",
        jj_workspaces
    );
    assert!(
        jj_workspaces.contains(&"default".to_string()),
        "jj workspace list should still include default, got: {:?}",
        jj_workspaces
    );
}

#[test]
fn test_jj_get_changed_files_ignores_gitignored_noise_in_workspace() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let gitignore = repo.read_gitignore().expect("Failed to read .gitignore");
    repo.create_file(".gitignore", &format!("{gitignore}node_modules/\n"))
        .expect("Failed to update .gitignore");
    TestRepo::run_git(&repo.repo_path, &["add", ".gitignore"][..])
        .expect("Failed to stage .gitignore");
    TestRepo::run_git(
        &repo.repo_path,
        &["commit", "-m", "Ignore node_modules"][..],
    )
    .expect("Failed to commit .gitignore");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/ignored-jj-noise",
        None,
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().expect("utf-8");

    TestRepo::write_workspace_file(
        workspace_path_str,
        "node_modules/pkg/index.js",
        "console.log('ignored');\n",
    )
    .expect("Failed to write node_modules file");
    TestRepo::write_workspace_file(
        workspace_path_str,
        ".treq/cache/tmp.txt",
        "ignored treq cache\n",
    )
    .expect("Failed to write .treq cache file");
    TestRepo::write_workspace_file(
        workspace_path_str,
        ".jj-backup/state.txt",
        "ignored jj backup\n",
    )
    .expect("Failed to write .jj-backup file");

    let changed_files = treq_lib::jj::jj_get_changed_files(workspace_path_str)
        .expect("Failed to get changed files");

    assert!(
        changed_files.is_empty(),
        "Expected ignored noise to be excluded, got {:?}",
        changed_files
    );
}

#[test]
fn test_jj_get_changed_files_honors_nested_gitignore() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/nested-gitignore",
        None,
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().expect("utf-8");

    TestRepo::write_workspace_file(workspace_path_str, "generated/.gitignore", "ignored.txt\n")
        .expect("Failed to write nested .gitignore");
    TestRepo::write_workspace_file(
        workspace_path_str,
        "generated/ignored.txt",
        "nested ignored\n",
    )
    .expect("Failed to write ignored file");

    let changed_files = treq_lib::jj::jj_get_changed_files(workspace_path_str)
        .expect("Failed to get changed files");

    assert!(
        changed_files
            .iter()
            .all(|change| change.path != "generated/ignored.txt"),
        "Expected nested .gitignore to suppress ignored file, got {:?}",
        changed_files
    );
}

#[test]
fn test_jj_get_changed_files_keeps_tracked_files_visible_after_ignore_rule_added() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/tracked-after-ignore",
        None,
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().expect("utf-8");

    TestRepo::write_workspace_file(workspace_path_str, "tracked.txt", "version one\n")
        .expect("Failed to write tracked file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Track file")
        .expect("Failed to commit tracked file");

    TestRepo::write_workspace_file(workspace_path_str, ".gitignore", "tracked.txt\n")
        .expect("Failed to write .gitignore");
    TestRepo::write_workspace_file(workspace_path_str, "tracked.txt", "version two\n")
        .expect("Failed to modify tracked file");

    let changed_files = treq_lib::jj::jj_get_changed_files(workspace_path_str)
        .expect("Failed to get changed files");

    assert!(
        changed_files
            .iter()
            .any(|change| change.path == "tracked.txt"),
        "Tracked file should remain visible after ignore rule, got {:?}",
        changed_files
    );
}

#[test]
fn test_ensure_jj_initialized_reinits_when_jj_deleted() {
    let repo = TestRepo::new().expect("Failed to create test repo");

    // Verify .jj exists
    assert!(repo.is_jj_initialized(), ".jj should exist after init");

    // Delete .jj
    TestRepo::remove_dir_all_path(Path::new(&repo.repo_path).join(".jj"))
        .expect("Failed to remove .jj");
    assert!(!repo.is_jj_initialized(), ".jj should be gone");

    // Create a DB for ensure_jj_initialized
    let db = repo.create_db().expect("Failed to create db");

    // Set the flag to true (simulating already-configured state)
    db.set_repo_setting(&repo.repo_path, "jj_initialized", "true")
        .expect("Failed to set flag");

    // ensure_jj_initialized should detect missing .jj and reinit
    let result = treq_lib::jj::ensure_jj_initialized(&db, &repo.repo_path)
        .expect("ensure_jj_initialized failed");
    assert!(result, "Should return true after reinit");

    // .jj should exist again
    assert!(
        repo.is_jj_initialized(),
        ".jj should exist again after ensure_jj_initialized"
    );
}

#[test]
fn test_empty_commits_excluded_from_commits_ahead() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let default_branch = repo.default_branch();

    let workspace: Workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/empty-filter",
        Some("empty filter test".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().unwrap();

    // Create a real commit with content
    TestRepo::write_workspace_file(workspace_path_str, "real.txt", "real content")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Add real file")
        .expect("Failed to commit");

    // Create empty commits via `jj new` (these have no file changes)
    Command::new("jj")
        .current_dir(workspace_path_str)
        .args(["new"])
        .output()
        .expect("Failed to run jj new");
    Command::new("jj")
        .current_dir(workspace_path_str)
        .args(["new"])
        .output()
        .expect("Failed to run jj new");

    // Verify that jj_get_commits_ahead only returns the real commit
    let target_branch = workspace.target_branch.as_deref().unwrap_or(default_branch);
    let commits_ahead = jj::jj_get_commits_ahead(workspace_path_str, target_branch)
        .expect("Failed to get commits ahead");

    assert_eq!(
        commits_ahead.total_count, 1,
        "Should only have 1 non-empty commit ahead, got {}",
        commits_ahead.total_count
    );
    assert!(
        commits_ahead.commits[0]
            .description
            .contains("Add real file"),
        "The commit should be the real one, got: {}",
        commits_ahead.commits[0].description
    );
}

#[test]
fn test_merge_workspace_with_empty_commits_cases() {
    // Table-driven: each merge strategy (Merge, SquashAndMerge, RebaseAndMerge)
    // should succeed despite trailing empty commits in the workspace, and clean up
    // the workspace afterward. These used to be three near-identical tests
    // differing only in branch/file names, empty commit count, and merge strategy.
    struct Case {
        name: &'static str,
        branch: &'static str,
        file_name: &'static str,
        file_contents: &'static str,
        commit_message: &'static str,
        empty_commit_count: usize,
        merge_message: &'static str,
        strategy: MergeCommit,
        // Only the original "merge" case additionally checked list_commits excludes
        // empty commits; the other two cases didn't assert on this.
        check_list_commits_excludes_empty: bool,
    }

    let cases = vec![
        Case {
            name: "plain merge abandons empty commits",
            branch: "feat/merge-empty",
            file_name: "feature.txt",
            file_contents: "feature content",
            commit_message: "Add feature",
            empty_commit_count: 1,
            merge_message: "Merge feat/merge-empty",
            strategy: MergeCommit::Merge,
            check_list_commits_excludes_empty: true,
        },
        Case {
            name: "squash merge with empty commits",
            branch: "feat/squash-empty",
            file_name: "squash.txt",
            file_contents: "squash content",
            commit_message: "Add squash file",
            empty_commit_count: 2,
            merge_message: "Squash feat/squash-empty",
            strategy: MergeCommit::SquashAndMerge,
            check_list_commits_excludes_empty: false,
        },
        Case {
            name: "rebase merge with empty commits",
            branch: "feat/rebase-empty",
            file_name: "rebase.txt",
            file_contents: "rebase content",
            commit_message: "Add rebase file",
            empty_commit_count: 1,
            merge_message: "Rebase feat/rebase-empty",
            strategy: MergeCommit::RebaseAndMerge,
            check_list_commits_excludes_empty: false,
        },
    ];

    for case in cases {
        let repo = TestRepo::new().expect("Failed to create test repo");

        let workspace: Workspace = treq_lib::core::create_workspace(
            &repo.repo_path,
            case.branch,
            Some(format!("{} test", case.name)),
            None,
            None,
            None,
            None,
        )
        .unwrap_or_else(|error| panic!("[{}] Failed to create workspace: {:?}", case.name, error));

        let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
        let workspace_path_str = workspace_path.to_str().unwrap();

        // Create a real commit
        TestRepo::write_workspace_file(workspace_path_str, case.file_name, case.file_contents)
            .unwrap_or_else(|error| panic!("[{}] Failed to write file: {:?}", case.name, error));
        treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, case.commit_message)
            .unwrap_or_else(|error| panic!("[{}] Failed to commit: {:?}", case.name, error));

        // Create empty commits
        for _ in 0..case.empty_commit_count {
            Command::new("jj")
                .current_dir(workspace_path_str)
                .args(["new"])
                .output()
                .unwrap_or_else(|error| panic!("[{}] Failed to run jj new: {:?}", case.name, error));
        }

        if case.check_list_commits_excludes_empty {
            let log =
                treq_lib::core::list_commits(&repo.repo_path, Some(workspace.id), false, None, None)
                    .unwrap_or_else(|error| panic!("[{}] list_commits failed: {:?}", case.name, error));
            assert_eq!(
                log.commits.len(),
                1,
                "[{}] list_commits should not include empty commits, got: {:?}",
                case.name,
                log.commits
                    .iter()
                    .map(|c| c.description.as_str())
                    .collect::<Vec<_>>()
            );
            assert!(
                log.commits[0].description.contains(case.commit_message),
                "[{}] Expected the real commit only, got: {:?}",
                case.name,
                log.commits[0].description
            );
        }

        // Merge should succeed despite empty commits
        treq_lib::core::merge_workspace(
            &repo.repo_path,
            workspace.id,
            case.merge_message,
            case.strategy,
        )
        .unwrap_or_else(|error| {
            panic!(
                "[{}] Failed to merge workspace with empty commits: {:?}",
                case.name, error
            )
        });

        // Verify the file is in the main repo
        assert!(
            Path::new(&repo.repo_path).join(case.file_name).exists(),
            "[{}] File should exist in main repo after merge",
            case.name
        );

        // Verify workspace is cleaned up
        assert!(
            !workspace_path.exists(),
            "[{}] Workspace directory should be deleted after merge",
            case.name
        );
    }
}

#[test]
fn test_pull_workspace_resolves_divergence() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/pull-diverged",
        Some("test pull diverged".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().unwrap();

    // Add initial commit B and push
    TestRepo::write_workspace_file(workspace_path_str, "file1.txt", "content 1")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Commit B")
        .expect("Failed to commit");
    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("Failed to push workspace");

    // Make local commit D (don't push)
    TestRepo::write_workspace_file(workspace_path_str, "local-file.txt", "local content")
        .expect("Failed to write file");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Local commit D")
        .expect("Failed to commit");

    // Commit C and push from a clone to simulate remote-ahead
    repo.remote_commit_on_branch(
        &workspace.branch_name,
        "remote-file.txt",
        "from remote",
        "Remote commit C",
    )
    .expect("Failed to create remote commit C");

    // Call pull_workspace_from_remote to resolve the divergence
    let result =
        treq_lib::core::pull_workspace_from_remote(&repo.repo_path, Some(workspace.id), "git")
            .expect("pull_workspace_from_remote should succeed");

    assert!(result.success, "Pull should succeed");
    assert!(result.was_diverged, "Should detect divergence");
    assert_eq!(
        result.commits_rebased, 1,
        "Should rebase 1 local commit (D)"
    );

    // Verify bookmark is no longer conflicted
    assert!(
        !jj::jj_is_bookmark_conflicted(workspace_path_str, &workspace.branch_name),
        "Bookmark should no longer be conflicted after pull"
    );

    // Verify both files exist (remote-file.txt from C, local-file.txt from D)
    // Update stale first since rebase may have changed things
    let _ = jj::jj_workspace_update_stale(workspace_path_str);
    assert!(
        workspace_path.join("remote-file.txt").exists(),
        "remote-file.txt should exist from remote commit C"
    );
    assert!(
        workspace_path.join("local-file.txt").exists(),
        "local-file.txt should exist from rebased local commit D"
    );

    // Verify sync status is no longer Diverged
    let status = treq_lib::core::workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");

    assert!(
        !matches!(status.remote_sync, RemoteSyncStatus::Diverged { .. }),
        "Workspace should no longer be Diverged after pull, got: {:?}",
        status.remote_sync
    );
}

#[test]
fn test_pull_workspace_from_remote_branch_stack_handles_conflicted_bookmark() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let parent = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feature-remote",
        Some("remote parent".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create parent workspace from remote branch");
    let child = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/stacked-child",
        Some("stacked child".to_string()),
        None,
        Some(&parent.branch_name),
        None,
        None,
    )
    .expect("Failed to create stacked child workspace");

    let parent_path = repo.workspaces_dir().join(&parent.workspace_path);
    let parent_path_str = parent_path.to_str().expect("utf8 parent path");

    TestRepo::write_workspace_file(parent_path_str, "local-parent.txt", "local parent change\n")
        .expect("Failed to write local parent change");
    treq_lib::core::commit_workspace(&repo.repo_path, parent.id, "Local parent commit")
        .expect("Failed to create local parent commit");

    repo.remote_commit_on_branch(
        &parent.branch_name,
        "remote-parent.txt",
        "remote parent change\n",
        "Remote parent commit",
    )
    .expect("Failed to create remote parent commit");

    treq_lib::jj::jj_git_fetch(&repo.repo_path).expect("Failed to fetch remote changes");

    assert!(
        treq_lib::jj::jj_is_bookmark_conflicted(parent_path_str, &parent.branch_name),
        "Parent bookmark should be conflicted before pull"
    );

    let result =
        treq_lib::core::pull_workspace_from_remote(&repo.repo_path, Some(parent.id), "git")
            .expect("pull_workspace_from_remote should succeed for stacked remote branch");

    assert!(result.success, "Pull should report success");
    assert!(result.was_diverged, "Pull should detect divergence");
    assert_eq!(
        result.commits_rebased, 1,
        "Expected one local commit to be rebased"
    );
    assert!(
        !treq_lib::jj::jj_is_bookmark_conflicted(parent_path_str, &parent.branch_name),
        "Parent bookmark should be resolved after pull"
    );

    let child_path = repo.workspaces_dir().join(&child.workspace_path);
    let child_path_str = child_path.to_str().expect("utf8 child path");
    let _ = treq_lib::jj::jj_workspace_update_stale(child_path_str);
    assert!(
        child_path.join("local-parent.txt").exists(),
        "Child workspace should retain access to stacked parent history"
    );
}

#[test]
fn test_pull_workspace_no_divergence() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/pull-no-div",
        Some("test pull no divergence".to_string()),
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

    // No local changes — simulate remote advancing
    repo.remote_commit_on_branch(
        &workspace.branch_name,
        "remote-only.txt",
        "remote content",
        "Remote commit",
    )
    .expect("Failed to create remote commit");

    // Call pull — should NOT be diverged (local has no unpushed commits)
    let result =
        treq_lib::core::pull_workspace_from_remote(&repo.repo_path, Some(workspace.id), "git")
            .expect("pull_workspace_from_remote should succeed");

    assert!(result.success, "Pull should succeed");
    assert!(!result.was_diverged, "Should NOT detect divergence");
    assert_eq!(result.commits_rebased, 0, "Should rebase 0 commits");
}

#[test]
fn test_pull_home_repo_fetches_remote_commits() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");
    let default_branch = repo.default_branch();
    let origin_default_revset = format!("{default_branch}@origin");

    // Record the git branch before pull
    let branch_before =
        jj::get_workspace_branch(&repo.repo_path).expect("Failed to get git branch before pull");

    // Create a commit in the remote
    repo.remote_commit_file(
        "remote-commit.txt",
        "from remote\n",
        "Remote commit on main",
    )
    .expect("Failed to create remote commit");

    // Pull using home repo (workspace_id = None) — fetches remote refs
    let result = treq_lib::core::pull_workspace_from_remote(&repo.repo_path, None, "git")
        .expect("pull_workspace_from_remote(None) should succeed");
    assert!(result.success, "Home repo pull should succeed");

    // Verify the remote commit is visible via jj log (default branch@origin should have advanced)
    let log_output = Command::new("jj")
        .current_dir(&repo.repo_path)
        .args([
            "log",
            "-r",
            &origin_default_revset,
            "--no-graph",
            "-T",
            r#"description"#,
        ])
        .output()
        .expect("Failed to run jj log");
    let log_str = String::from_utf8_lossy(&log_output.stdout);
    assert!(
        log_str.contains("Remote commit on main"),
        "{origin_default_revset} should contain the remote commit after fetch, got: {}",
        log_str
    );

    // Verify pull did not change the git branch (no checkout to different branch/tag)
    let branch_after =
        jj::get_workspace_branch(&repo.repo_path).expect("Failed to get git branch after pull");
    assert_eq!(
        branch_after, branch_before,
        "Pull should not change git branch, was '{}' before but '{}' after",
        branch_before, branch_after
    );
}

#[test]
fn test_workspace_status_home_repo() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    // Get home repo status with workspace_id = None
    let status = treq_lib::core::workspace_status(&repo.repo_path, None)
        .expect("workspace_status(None) should succeed");

    // Should return a synthetic home workspace
    assert_eq!(
        status.partial.current.id, 0,
        "Home repo workspace id should be 0"
    );
    assert_eq!(status.partial.current.workspace_name, "home");

    // Should be InSync with remote (no local-only commits)
    assert_eq!(
        status.remote_sync,
        RemoteSyncStatus::InSync,
        "Home repo should be InSync initially, got {:?}",
        status.remote_sync
    );

    // DAG should be empty for home repo
    assert!(
        status.dag_nodes.is_empty(),
        "Home repo should have no DAG nodes"
    );
    assert!(
        status.children.is_empty(),
        "Home repo should have no children"
    );
    assert!(status.target.is_none(), "Home repo should have no target");
}

#[test]
fn test_workspace_status_with_workspace_id() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/ws-status-test",
        Some("workspace status test".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().unwrap();

    // Push initial commit to establish remote branch
    TestRepo::write_workspace_file(workspace_path_str, "initial.txt", "initial\n")
        .expect("Failed to write");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Initial commit")
        .expect("Failed to commit");
    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("Failed to push");
    treq_lib::core::pull_workspace_from_remote(&repo.repo_path, Some(workspace.id), "git")
        .expect("Failed to pull");

    // Should be InSync after push+pull
    let status = treq_lib::core::workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");
    assert_eq!(
        status.remote_sync,
        RemoteSyncStatus::InSync,
        "Should be InSync after push+pull, got {:?}",
        status.remote_sync
    );
    assert_eq!(status.partial.current.id, workspace.id);

    // Make a local commit → should be Ahead
    TestRepo::write_workspace_file(workspace_path_str, "local.txt", "local\n")
        .expect("Failed to write");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "Local commit")
        .expect("Failed to commit");

    let status = treq_lib::core::workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");
    assert_eq!(
        status.remote_sync,
        RemoteSyncStatus::Ahead { count: 1 },
        "Should be Ahead {{ count: 1 }} after local commit, got {:?}",
        status.remote_sync
    );

    // Push + pull → back to InSync
    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("Failed to push");
    treq_lib::core::pull_workspace_from_remote(&repo.repo_path, Some(workspace.id), "git")
        .expect("Failed to pull");

    let status = treq_lib::core::workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");
    assert_eq!(
        status.remote_sync,
        RemoteSyncStatus::InSync,
        "Should be InSync after push+pull, got {:?}",
        status.remote_sync
    );
    assert!(
        status.dag_nodes.is_empty(),
        "workspace_status should not build DAG nodes"
    );
    assert!(
        status.conflicted_workspace_ids.is_empty(),
        "workspace_status should not return DAG-derived conflict IDs"
    );
}

#[test]
fn test_pull_workspace_surfaces_file_conflicts_after_divergent_same_file_edits() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/remote-conflict",
        Some("test remote conflict".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().unwrap();

    // Shared base on the workspace branch, pushed to remote.
    TestRepo::write_workspace_file(workspace_path_str, "shared.txt", "base\n")
        .expect("Failed to write shared base");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "shared base")
        .expect("Failed to commit shared base");
    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("Failed to push shared base");

    // Local-only divergent edit of the same file.
    TestRepo::write_workspace_file(workspace_path_str, "shared.txt", "local edit\n")
        .expect("Failed to write local edit");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "local edit")
        .expect("Failed to commit local edit");

    // Remote-only divergent edit of the same file.
    repo.remote_commit_on_branch(
        &workspace.branch_name,
        "shared.txt",
        "remote edit\n",
        "remote edit",
    )
    .expect("Failed to create remote conflicting edit");

    let pull =
        treq_lib::core::pull_workspace_from_remote(&repo.repo_path, Some(workspace.id), "git")
            .expect("pull_workspace_from_remote should succeed even when rebase conflicts");

    assert!(pull.was_diverged, "pull should detect divergence");
    assert!(
        pull.has_conflicts,
        "pull result must report has_conflicts so Sync can skip push"
    );

    let status = treq_lib::core::workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("workspace_status should succeed");

    assert!(
        status.partial.has_conflicts,
        "workspace should report has_conflicts after conflicting remote pull"
    );
    assert!(
        status
            .conflicted_files
            .iter()
            .any(|f| f == "shared.txt" || f.ends_with("/shared.txt")),
        "ShowWorkspace needs conflicted_files including shared.txt after remote conflict, got {:?}",
        status.conflicted_files
    );
}

#[test]
fn test_pull_advances_bookmark_past_origin_when_rebasing_local_commits() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/pull-bookmark-tip",
        Some("pull bookmark tip".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().unwrap();

    TestRepo::write_workspace_file(workspace_path_str, "shared.txt", "base\n").expect("write base");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "shared base")
        .expect("commit base");
    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("push base");

    TestRepo::write_workspace_file(workspace_path_str, "shared.txt", "local edit\n")
        .expect("write local");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "local edit")
        .expect("commit local");

    repo.remote_commit_on_branch(
        &workspace.branch_name,
        "other.txt",
        "remote only\n",
        "remote other file",
    )
    .expect("remote non-conflicting commit");

    treq_lib::core::pull_workspace_from_remote(&repo.repo_path, Some(workspace.id), "git")
        .expect("pull should rebase local onto remote");

    let status = treq_lib::core::workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("status after pull");
    assert!(
        matches!(status.remote_sync, RemoteSyncStatus::Ahead { count } if count >= 1),
        "after pull, bookmark must include rebased local commits (Ahead of origin); got {:?}",
        status.remote_sync
    );

    assert!(
        status.conflicted_files.is_empty() && !status.partial.has_conflicts,
        "non-overlapping edits must not leave conflicts, got files={:?} has_conflicts={}",
        status.conflicted_files,
        status.partial.has_conflicts
    );

    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("push should publish rebased local commits");

    let status_after = treq_lib::core::workspace_status(&repo.repo_path, Some(workspace.id))
        .expect("status after push");
    assert!(
        matches!(status_after.remote_sync, RemoteSyncStatus::InSync),
        "expected InSync after publishing rebased local tip, got {:?}",
        status_after.remote_sync
    );
}

#[test]
fn test_pull_with_conflicts_keeps_conflicted_tip_on_bookmark_for_local_resolve() {
    let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");

    let workspace = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/pull-conflict-bookmark",
        Some("pull conflict bookmark".to_string()),
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create workspace");

    let workspace_path = repo.workspaces_dir().join(&workspace.workspace_path);
    let workspace_path_str = workspace_path.to_str().unwrap();

    TestRepo::write_workspace_file(workspace_path_str, "shared.txt", "base\n").expect("write base");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "shared base")
        .expect("commit base");
    treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
        .expect("push base");

    TestRepo::write_workspace_file(workspace_path_str, "shared.txt", "local edit\n")
        .expect("write local");
    treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "local edit")
        .expect("commit local");

    repo.remote_commit_on_branch(
        &workspace.branch_name,
        "shared.txt",
        "remote edit\n",
        "remote edit",
    )
    .expect("remote conflict");

    treq_lib::core::pull_workspace_from_remote(&repo.repo_path, Some(workspace.id), "git")
        .expect("pull");

    let status =
        treq_lib::core::workspace_status(&repo.repo_path, Some(workspace.id)).expect("status");

    assert!(
        status.partial.has_conflicts,
        "conflicts must be visible for local resolve"
    );
    assert!(
        status.conflicted_files.iter().any(|f| f == "shared.txt"),
        "shared.txt must be in conflicted_files, got {:?}",
        status.conflicted_files
    );

    // Bookmark must point at the conflicted rebased tip (Ahead), not stuck on origin tip.
    // Otherwise Sync reports InSync, push is a no-op, and users are forced to resolve on the remote.
    assert!(
        matches!(status.remote_sync, RemoteSyncStatus::Ahead { .. }),
        "conflicted rebased tip must be on the bookmark (Ahead of origin) so resolve-then-push works; got {:?}",
        status.remote_sync
    );
}

#[test]
fn test_retarget_workspace_lifts_bridge_when_parent_moves_below_child() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let default_branch = repo.default_branch().to_string();

    let parent = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/parent",
        None,
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create parent");
    let child = treq_lib::core::create_workspace(
        &repo.repo_path,
        "feat/child",
        None,
        None,
        None,
        None,
        None,
    )
    .expect("Failed to create child");

    treq_lib::core::retarget_workspace(&repo.repo_path, child.id, "feat/parent", &default_branch)
        .expect("Failed to stack child on parent");

    treq_lib::core::retarget_workspace(&repo.repo_path, parent.id, "feat/child", &default_branch)
        .expect("Failed to move parent below child");

    let after_parent = treq_lib::local_db::get_workspace_by_id(&repo.repo_path, parent.id)
        .expect("db lookup")
        .expect("parent exists");
    let after_child = treq_lib::local_db::get_workspace_by_id(&repo.repo_path, child.id)
        .expect("db lookup")
        .expect("child exists");

    assert_eq!(
        after_parent.target_branch.as_deref(),
        Some("feat/child"),
        "parent should now target child"
    );
    assert_eq!(
        after_child.target_branch.as_deref(),
        Some(default_branch.as_str()),
        "child should have been lifted onto parent's old target"
    );
}
