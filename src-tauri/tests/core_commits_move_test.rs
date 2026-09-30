//! Moving a commit to another workspace must take it out of the source
//! history, not leave it there with an inverse diff in the working copy.
mod e2e_test_helpers;

use e2e_test_helpers::{JjVerifier, TestRepo};

fn source_with_commit(repo: &TestRepo) -> (treq_lib::local_db::Workspace, String, String) {
  let source = repo
    .create_workspace_with_commit("feat/move-src", "moved.txt", "moved\n", None)
    .unwrap();
  let path = repo.workspace_full_path(&source);
  let change_id = TestRepo::jj_change_id(&path, "@-").unwrap();
  (source, path, change_id)
}

#[test]
fn move_commit_removes_it_from_source_without_inverse_diff() {
  let repo = TestRepo::new().unwrap();
  let (source, source_path, change_id) = source_with_commit(&repo);
  let target = repo.create_workspace_simple("feat/move-dst").unwrap();
  let target_path = repo.workspace_full_path(&target);

  treq_lib::core::move_commit_to_existing_workspace(
    &repo.repo_path,
    source.id,
    &change_id,
    target.id,
  )
  .unwrap();

  assert!(JjVerifier::file_exists_in_workspace(
    &target_path,
    "moved.txt"
  ));
  let target_changes = treq_lib::jj::jj_get_changed_files(&target_path).unwrap();
  assert_eq!(target_changes.len(), 1, "{target_changes:?}");
  assert!(!JjVerifier::file_exists_in_workspace(
    &source_path,
    "moved.txt"
  ));
  assert!(TestRepo::jj_working_copy_is_clean(&source_path));
  let source_log = TestRepo::jj_log_descriptions(&source_path, "::@", None).unwrap();
  assert!(
    source_log.iter().all(|(d, _)| d != "Add moved.txt"),
    "{source_log:?}"
  );
}

#[test]
fn move_commit_into_its_own_workspace_is_refused() {
  let repo = TestRepo::new().unwrap();
  let (source, source_path, change_id) = source_with_commit(&repo);

  let result = treq_lib::core::move_commit_to_existing_workspace(
    &repo.repo_path,
    source.id,
    &change_id,
    source.id,
  );

  assert!(result.is_err());
  assert!(TestRepo::jj_working_copy_is_clean(&source_path));
  assert!(JjVerifier::file_exists_in_workspace(
    &source_path,
    "moved.txt"
  ));
}
