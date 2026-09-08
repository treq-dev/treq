mod e2e_test_helpers;
use e2e_test_helpers::TestRepo;

fn remote_branch_messages(repo: &TestRepo, branch_name: &str) -> String {
  let remote_path = repo.remote_path();
  let remote_path_str = remote_path.to_str().expect("utf-8 path");
  TestRepo::run_git(
    remote_path_str,
    &["log", "--format=%s", &format!("refs/heads/{branch_name}")],
  )
  .expect("git log on remote failed")
}

#[test]
fn test_push_workspace_excludes_empty_commits_from_remote() {
  let repo = TestRepo::with_remote().expect("Failed to create test repo with remote");
  let workspace = repo
    .setup_workspace_with_pushed_commit("feat/push-no-empty", "first.txt", "hello\n")
    .expect("failed to create and push initial workspace commit");

  let ws_dir = repo.workspaces_dir().join(&workspace.workspace_path);
  let ws_dir_str = ws_dir.to_str().expect("utf-8");

  // Simulate an empty commit left behind in local history (e.g. by a squash/rebase
  // that absorbed its content elsewhere) by describing an unchanged commit directly
  // via jj, bypassing commit_workspace.
  TestRepo::run_jj(ws_dir_str, &["new"]).expect("jj new failed");
  TestRepo::run_jj(ws_dir_str, &["describe", "-m", "stray empty"]).expect("jj describe failed");
  TestRepo::run_jj(ws_dir_str, &["new"]).expect("jj new failed");

  TestRepo::write_workspace_file(ws_dir_str, "second.txt", "world\n")
    .expect("failed to write file");
  treq_lib::core::commit_workspace(&repo.repo_path, workspace.id, "add second")
    .expect("commit_workspace should succeed");

  treq_lib::core::push_workspace_to_remote(&repo.repo_path, Some(workspace.id))
    .expect("push_workspace_to_remote should succeed");

  let remote_messages = remote_branch_messages(&repo, &workspace.branch_name);
  assert!(
    !remote_messages.contains("stray empty"),
    "expected empty commit to never reach the remote, got:\n{remote_messages}"
  );
  assert!(
    remote_messages.contains("add second"),
    "expected the real commit to reach the remote, got:\n{remote_messages}"
  );

  // The empty commit must also be gone locally, not merely excluded from the push.
  let local_log = TestRepo::run_jj(
    ws_dir_str,
    &[
      "log",
      "--no-graph",
      "-T",
      "description.first_line() ++ \"\\n\"",
      "-n",
      "20",
    ],
  )
  .expect("jj log failed");
  assert!(
    !local_log.contains("stray empty"),
    "expected empty commit to be discarded locally too, got:\n{local_log}"
  );
}
