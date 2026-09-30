//! Concurrent `treq commits create` processes on one workspace must not
//! fork the working-copy change or conflict the workspace bookmark.
#![cfg(desktop)]
mod e2e_test_helpers;

use e2e_test_helpers::TestRepo;
use std::process::{Command, Stdio};
use treq_lib::core::remote::TreqCommandRequest;

#[test]
fn parallel_commits_on_one_workspace_do_not_diverge() {
  let repo = TestRepo::new().unwrap();
  let ws = repo.create_workspace_simple("parw1").unwrap();
  let path = repo.workspace_full_path(&ws);
  TestRepo::write_workspace_file(&path, "a.txt", "a\n").unwrap();

  let children: Vec<_> = (0..5)
    .map(|i| {
      let args = TreqCommandRequest::CreateCommit {
        repo: repo.repo_path.clone(),
        workspace: Some(ws.id.to_string()),
        message: format!("parallel {i}"),
        base_change_id: None,
        idempotency_key: format!("par-{i}"),
      }
      .cli_args()
      .unwrap();
      Command::new(env!("CARGO_BIN_EXE_treq"))
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
    })
    .collect();
  for mut child in children {
    child.wait().unwrap();
  }

  let all = TestRepo::jj_change_ids_in_revset(&path, "all()").unwrap();
  let unique: std::collections::HashSet<_> = all.iter().collect();
  assert_eq!(all.len(), unique.len(), "divergent change ids: {all:?}");
  let tips = TestRepo::jj_commit_ids_in_revset(&path, "parw1").unwrap();
  assert_eq!(tips.len(), 1, "bookmark is conflicted: {tips:?}");
}
