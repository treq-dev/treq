mod e2e_test_helpers;

use e2e_test_helpers::{TestRepo, FAILING_WORKFLOW, PASSING_WORKFLOW};
use treq_lib::core;

#[test]
fn test_list_workflows_empty_for_fresh_repo() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let result = core::list_workflows_sync(&repo.repo_path).expect("Failed to list workflows");
    assert!(result.is_empty());
}

#[test]
fn test_list_workflows_sees_yaml_file() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    repo.write_workflow("ci.yaml", PASSING_WORKFLOW)
        .expect("Failed to write workflow");
    let result = core::list_workflows_sync(&repo.repo_path).expect("Failed to list workflows");
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].name, "Passing CI");
}

#[test]
fn test_list_workflows_multiple_files_sorted() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    repo.write_workflow("b.yaml", PASSING_WORKFLOW)
        .expect("Failed to write b.yaml");
    repo.write_workflow("a.yaml", FAILING_WORKFLOW)
        .expect("Failed to write a.yaml");
    let result = core::list_workflows_sync(&repo.repo_path).expect("Failed to list workflows");
    assert_eq!(result.len(), 2);
    assert!(result[0].filename < result[1].filename);
}

#[test]
fn test_run_workflow_job_success() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    repo.write_workflow("ci.yaml", PASSING_WORKFLOW)
        .expect("Failed to write workflow");
    treq_lib::local_db::trust_repo(&repo.repo_path).expect("Failed to trust repo");
    let result = core::run_workflow_job_sync(&repo.repo_path, "ci.yaml", "greet", 0, &repo.repo_path)
        .expect("Failed to run job");
    assert!(result.success);
    assert!(!result.steps.is_empty());
}

#[test]
fn test_run_workflow_job_stops_at_first_failure() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    repo.write_workflow("ci.yaml", FAILING_WORKFLOW)
        .expect("Failed to write workflow");
    treq_lib::local_db::trust_repo(&repo.repo_path).expect("Failed to trust repo");
    let result = core::run_workflow_job_sync(&repo.repo_path, "ci.yaml", "check", 0, &repo.repo_path)
        .expect("Failed to run job");
    assert!(!result.success);
    assert_eq!(result.steps.len(), 1);
}

#[test]
fn test_run_workflow_job_unknown_job_error() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    repo.write_workflow("ci.yaml", PASSING_WORKFLOW)
        .expect("Failed to write workflow");
    treq_lib::local_db::trust_repo(&repo.repo_path).expect("Failed to trust repo");
    let err = core::run_workflow_job_sync(&repo.repo_path, "ci.yaml", "nonexistent", 0, &repo.repo_path)
        .unwrap_err();
    assert!(err.contains("nonexistent"));
}

#[test]
fn test_run_workflow_runs_all_jobs() {
    let repo = TestRepo::new().expect("Failed to create test repo");
    let content = "name: Multi Job\non:\n  workflow_dispatch: {}\njobs:\n  job1:\n    steps:\n      - name: step1\n        run: echo a\n  job2:\n    steps:\n      - name: step2\n        run: echo b\n";
    repo.write_workflow("multi.yaml", content)
        .expect("Failed to write workflow");
    treq_lib::local_db::trust_repo(&repo.repo_path).expect("Failed to trust repo");
    let results = core::run_workflow_sync(&repo.repo_path, "multi.yaml", 0, &repo.repo_path)
        .expect("Failed to run workflow");
    assert_eq!(results.len(), 2);
    assert!(results.iter().all(|r| r.success));
}
