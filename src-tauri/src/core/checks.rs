use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const STEP_TIMEOUT_SECS: u64 = 60;
const MAX_CONCURRENT_JOBS: usize = 4;

// ── Internal YAML structs ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct WorkflowFile {
    name: String,
    jobs: HashMap<String, JobDef>,
}

#[derive(Deserialize)]
struct JobDef {
    name: Option<String>,
    steps: Vec<StepDef>,
}

#[derive(Deserialize)]
struct StepDef {
    name: String,
    run: String,
    #[serde(rename = "working-directory")]
    working_directory: Option<String>,
    env: Option<HashMap<String, String>>,
}

// ── Public API types ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowInfo {
    pub filename: String,
    pub name: String,
    pub jobs: Vec<JobInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JobInfo {
    pub id: String,
    pub name: String,
    pub steps: Vec<StepInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StepInfo {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StepResult {
    pub name: String,
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JobResult {
    pub job_id: String,
    pub steps: Vec<StepResult>,
    pub success: bool,
}

// ── Validation helpers ───────────────────────────────────────────────────────

fn validate_filename(filename: &str) -> Result<(), String> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err(format!(
            "Invalid workflow filename '{}': must not contain path separators or '..'",
            filename
        ));
    }
    if !filename.ends_with(".yaml") && !filename.ends_with(".yml") {
        return Err(format!(
            "Invalid workflow filename '{}': must have .yaml or .yml extension",
            filename
        ));
    }
    Ok(())
}

fn validate_working_directory(wd: &str) -> Result<(), String> {
    if Path::new(wd).is_absolute() {
        return Err(format!(
            "working-directory must be a relative path, got: '{}'",
            wd
        ));
    }
    if wd.split('/').any(|c| c == "..") || wd.split('\\').any(|c| c == "..") {
        return Err(format!(
            "working-directory must not traverse parent directories: '{}'",
            wd
        ));
    }
    Ok(())
}

// ── Public functions ─────────────────────────────────────────────────────────

pub fn list_workflows_sync(repo_path: &str) -> Result<Vec<WorkflowInfo>, String> {
    let workflows_dir = Path::new(repo_path).join(".treq").join("workflows");
    if !workflows_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries: Vec<_> = std::fs::read_dir(&workflows_dir)
        .map_err(|e| format!("Failed to read workflows dir: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.ends_with(".yaml") || name.ends_with(".yml")
        })
        .collect();

    entries.sort_by_key(|e| e.file_name());

    let canonical_dir = workflows_dir
        .canonicalize()
        .map_err(|e| format!("Failed to access workflows directory: {}", e))?;

    let mut workflows = Vec::new();
    for entry in entries {
        let filename = entry.file_name().to_string_lossy().to_string();

        // Verify each file stays within the workflows directory.
        let canonical_file = match entry.path().canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !canonical_file.starts_with(&canonical_dir) {
            continue;
        }

        let content = match std::fs::read_to_string(entry.path()) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let wf: WorkflowFile = match serde_yaml::from_str(&content) {
            Ok(w) => w,
            Err(_) => continue, // skip invalid YAML files
        };

        let mut jobs: Vec<JobInfo> = wf
            .jobs
            .into_iter()
            .map(|(id, def)| JobInfo {
                id: id.clone(),
                name: def.name.unwrap_or_else(|| id),
                steps: def
                    .steps
                    .into_iter()
                    .map(|s| StepInfo { name: s.name })
                    .collect(),
            })
            .collect();
        jobs.sort_by(|a, b| a.id.cmp(&b.id));

        workflows.push(WorkflowInfo {
            filename,
            name: wf.name,
            jobs,
        });
    }

    Ok(workflows)
}

pub fn run_workflow_job_sync(
    repo_path: &str,
    filename: &str,
    job_id: &str,
    workspace_id: i64,
    workspace_path: &str,
) -> Result<JobResult, String> {
    if !crate::local_db::is_repo_trusted(repo_path) {
        return Err(
            "repository_not_trusted: Trust this repository before running checks".to_string(),
        );
    }

    validate_filename(filename)?;

    let workflows_dir = Path::new(repo_path).join(".treq").join("workflows");
    let file_path = workflows_dir.join(filename);

    // Verify file stays inside the workflows directory after path normalization.
    let canonical_dir = workflows_dir
        .canonicalize()
        .map_err(|e| format!("Failed to access workflows directory: {}", e))?;
    let canonical_file = file_path
        .canonicalize()
        .map_err(|_| format!("Workflow file not found: '{}'", filename))?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err(format!(
            "Workflow file '{}' is outside the workflows directory",
            filename
        ));
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read '{}': {}", filename, e))?;
    let wf: WorkflowFile = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse '{}': {}", filename, e))?;

    let job_def = wf
        .jobs
        .into_iter()
        .find(|(id, _)| id == job_id)
        .map(|(_, def)| def)
        .ok_or_else(|| format!("Job '{}' not found in '{}'", job_id, filename))?;

    let base_dir = if Path::new(workspace_path).is_dir() {
        workspace_path.to_string()
    } else {
        repo_path.to_string()
    };

    let extended_path = crate::binary_paths::get_extended_path();
    let mut step_results = Vec::new();

    for step in &job_def.steps {
        let cwd = if let Some(wd) = &step.working_directory {
            validate_working_directory(wd)?;
            Path::new(&base_dir).join(wd).to_string_lossy().to_string()
        } else {
            base_dir.clone()
        };

        let mut cmd = Command::new("sh");
        cmd.args(["-c", &step.run])
            .current_dir(&cwd)
            .env("PATH", &extended_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if let Some(env_vars) = &step.env {
            for (k, v) in env_vars {
                cmd.env(k, v);
            }
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start step '{}': {}", step.name, e))?;

        let timeout = Duration::from_secs(STEP_TIMEOUT_SECS);
        let start = Instant::now();
        let exit_status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(format!(
                            "Step '{}' timed out after {} seconds",
                            step.name, STEP_TIMEOUT_SECS
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(format!("Failed waiting for step '{}': {}", step.name, e)),
            }
        };

        let success = exit_status.success();
        step_results.push(StepResult {
            name: step.name.clone(),
            success,
        });

        if !success {
            break;
        }
    }

    let overall_success = step_results.iter().all(|s| s.success);
    let result = JobResult {
        job_id: job_id.to_string(),
        steps: step_results,
        success: overall_success,
    };

    store_workflow_run(repo_path, workspace_id, filename, &result)?;

    Ok(result)
}

pub fn run_workflow_sync(
    repo_path: &str,
    filename: &str,
    workspace_id: i64,
    workspace_path: &str,
) -> Result<Vec<JobResult>, String> {
    let workflows = list_workflows_sync(repo_path)?;
    let wf = workflows
        .into_iter()
        .find(|w| w.filename == filename)
        .ok_or_else(|| format!("Workflow '{}' not found", filename))?;

    let job_ids: Vec<String> = wf.jobs.into_iter().map(|j| j.id).collect();
    let total = job_ids.len();

    let rp = repo_path.to_string();
    let fn_ = filename.to_string();
    let wp = workspace_path.to_string();

    let (result_tx, result_rx) = std::sync::mpsc::channel::<Result<JobResult, String>>();
    let mut job_iter = job_ids.into_iter();
    let mut in_flight = 0usize;
    let mut results = Vec::with_capacity(total);

    loop {
        // Refill the slot pool up to MAX_CONCURRENT_JOBS.
        while in_flight < MAX_CONCURRENT_JOBS {
            match job_iter.next() {
                Some(job_id) => {
                    let rp = rp.clone();
                    let fn_ = fn_.clone();
                    let wp = wp.clone();
                    let tx = result_tx.clone();
                    std::thread::spawn(move || {
                        let r = run_workflow_job_sync(&rp, &fn_, &job_id, workspace_id, &wp);
                        tx.send(r).ok();
                    });
                    in_flight += 1;
                }
                None => break,
            }
        }

        if in_flight == 0 {
            break;
        }

        match result_rx.recv() {
            Ok(Ok(r)) => {
                results.push(r);
                in_flight -= 1;
            }
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err("Job thread disconnected unexpectedly".to_string()),
        }
    }

    Ok(results)
}

pub fn store_workflow_run(
    repo_path: &str,
    workspace_id: i64,
    filename: &str,
    result: &JobResult,
) -> Result<(), String> {
    let steps_json = serde_json::to_string(&result.steps)
        .map_err(|e| format!("Failed to serialize steps: {}", e))?;
    crate::local_db::add_workflow_run(
        repo_path,
        workspace_id,
        filename,
        &result.job_id,
        result.success,
        &steps_json,
    )?;
    Ok(())
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_workflow(jobs_yaml: &str) -> String {
        format!(
            "name: Test Workflow\non:\n  workflow_dispatch: {{}}\njobs:\n{}",
            jobs_yaml
        )
    }

    fn write_workflow(dir: &TempDir, filename: &str, content: &str) -> String {
        let workflows_dir = dir.path().join(".treq").join("workflows");
        fs::create_dir_all(&workflows_dir).unwrap();
        fs::write(workflows_dir.join(filename), content).unwrap();
        dir.path().to_string_lossy().to_string()
    }

    fn setup_trusted_repo(dir: &TempDir, filename: &str, content: &str) -> String {
        let repo = write_workflow(dir, filename, content);
        crate::local_db::init_local_db(&repo).unwrap();
        crate::local_db::trust_repo(&repo).unwrap();
        repo
    }

    #[test]
    fn test_list_workflows_empty_when_no_dir() {
        let dir = TempDir::new().unwrap();
        let result = list_workflows_sync(&dir.path().to_string_lossy()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_list_workflows_parses_yaml() {
        let dir = TempDir::new().unwrap();
        let content = make_workflow(
            "  greet:\n    name: Greet Job\n    steps:\n      - name: Say hi\n        run: echo hi\n",
        );
        let repo = write_workflow(&dir, "ci.yaml", &content);
        let result = list_workflows_sync(&repo).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Test Workflow");
    }

    #[test]
    fn test_list_workflows_skips_non_yaml() {
        let dir = TempDir::new().unwrap();
        let workflows_dir = dir.path().join(".treq").join("workflows");
        fs::create_dir_all(&workflows_dir).unwrap();
        fs::write(workflows_dir.join("readme.txt"), "not yaml").unwrap();
        let result = list_workflows_sync(&dir.path().to_string_lossy()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_list_workflows_skips_invalid_yaml() {
        let dir = TempDir::new().unwrap();
        let workflows_dir = dir.path().join(".treq").join("workflows");
        fs::create_dir_all(&workflows_dir).unwrap();
        fs::write(
            workflows_dir.join("broken.yaml"),
            "this: is: not: valid: yaml: :::",
        )
        .unwrap();
        // valid workflow alongside the broken one
        let content = make_workflow("  j:\n    steps:\n      - name: s\n        run: echo x\n");
        fs::write(workflows_dir.join("valid.yaml"), &content).unwrap();
        let result = list_workflows_sync(&dir.path().to_string_lossy()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].filename, "valid.yaml");
    }

    #[test]
    fn test_list_workflows_sorted_by_filename() {
        let dir = TempDir::new().unwrap();
        let content = make_workflow("  j:\n    steps:\n      - name: s\n        run: echo x\n");
        let repo = write_workflow(&dir, "b.yaml", &content);
        write_workflow(&dir, "a.yaml", &content);
        let result = list_workflows_sync(&repo).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result[0].filename < result[1].filename);
    }

    #[test]
    fn test_run_job_requires_trust() {
        let dir = TempDir::new().unwrap();
        let content =
            make_workflow("  greet:\n    steps:\n      - name: Say hi\n        run: echo hi\n");
        let repo = write_workflow(&dir, "ci.yaml", &content);
        crate::local_db::init_local_db(&repo).unwrap();
        // NOT trusting the repo
        let err = run_workflow_job_sync(&repo, "ci.yaml", "greet", 0, &repo).unwrap_err();
        assert!(err.contains("repository_not_trusted"));
    }

    #[test]
    fn test_run_job_rejects_path_traversal_filename() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path().to_string_lossy().to_string();
        crate::local_db::init_local_db(&repo).unwrap();
        crate::local_db::trust_repo(&repo).unwrap();
        let err = run_workflow_job_sync(&repo, "../secret.yaml", "job", 0, &repo).unwrap_err();
        assert!(err.contains("Invalid workflow filename"));
    }

    #[test]
    fn test_run_job_success() {
        let dir = TempDir::new().unwrap();
        let content =
            make_workflow("  greet:\n    steps:\n      - name: Say hi\n        run: echo hi\n");
        let repo = setup_trusted_repo(&dir, "ci.yaml", &content);
        let result = run_workflow_job_sync(&repo, "ci.yaml", "greet", 0, &repo).unwrap();
        assert!(result.success);
        assert!(!result.steps.is_empty());
    }

    #[test]
    fn test_run_job_stops_at_first_failure() {
        let dir = TempDir::new().unwrap();
        let content = make_workflow(
            "  check:\n    steps:\n      - name: Fail\n        run: exit 1\n      - name: Skip\n        run: echo skip\n",
        );
        let repo = setup_trusted_repo(&dir, "ci.yaml", &content);
        let result = run_workflow_job_sync(&repo, "ci.yaml", "check", 0, &repo).unwrap();
        assert!(!result.success);
        assert_eq!(result.steps.len(), 1);
    }

    #[test]
    fn test_run_job_unknown_job_returns_error() {
        let dir = TempDir::new().unwrap();
        let content =
            make_workflow("  greet:\n    steps:\n      - name: hi\n        run: echo hi\n");
        let repo = setup_trusted_repo(&dir, "ci.yaml", &content);
        let err = run_workflow_job_sync(&repo, "ci.yaml", "nonexistent", 0, &repo).unwrap_err();
        assert!(err.contains("nonexistent"));
    }

    #[test]
    fn test_run_job_env_vars() {
        let dir = TempDir::new().unwrap();
        let content = "name: Env Test\non:\n  workflow_dispatch: {}\njobs:\n  check:\n    steps:\n      - name: Check env\n        run: test \"$MY_VAR\" = \"hello\"\n        env:\n          MY_VAR: hello\n";
        let repo = setup_trusted_repo(&dir, "env.yaml", content);
        let result = run_workflow_job_sync(&repo, "env.yaml", "check", 0, &repo).unwrap();
        assert!(result.success);
    }

    #[test]
    fn test_run_workflow_runs_all_jobs() {
        let dir = TempDir::new().unwrap();
        let content = "name: Multi\non:\n  workflow_dispatch: {}\njobs:\n  job1:\n    steps:\n      - name: s1\n        run: echo a\n  job2:\n    steps:\n      - name: s2\n        run: echo b\n";
        let repo = setup_trusted_repo(&dir, "multi.yaml", content);
        let results = run_workflow_sync(&repo, "multi.yaml", 0, &repo).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.success));
    }

    #[test]
    fn test_validate_filename_rejects_path_separators() {
        assert!(validate_filename("sub/dir/ci.yaml").is_err());
        assert!(validate_filename("../escape.yaml").is_err());
        assert!(validate_filename("ci.yaml").is_ok());
        assert!(validate_filename("ci.yml").is_ok());
    }

    #[test]
    fn test_validate_working_directory_rejects_absolute_and_traversal() {
        assert!(validate_working_directory("/absolute/path").is_err());
        assert!(validate_working_directory("../../etc").is_err());
        assert!(validate_working_directory("sub/dir").is_ok());
        assert!(validate_working_directory("frontend").is_ok());
    }
}
