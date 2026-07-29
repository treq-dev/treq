use crate::core::checks_logs::{
    infer_level, job_log_relative_path, strip_ansi, LogLine, LogWriter,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufRead;
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

/// Runs a single job as its own run (one row in the run history).
pub fn run_workflow_job_sync(
    repo_path: &str,
    filename: &str,
    job_id: &str,
    workspace_id: i64,
    workspace_path: &str,
) -> Result<JobResult, String> {
    let run_id = crate::local_db::create_workflow_run(repo_path, workspace_id, filename)?;
    let result = run_job_in_run(repo_path, filename, job_id, workspace_path, run_id, 0);
    let status = match &result {
        Ok(r) if r.success => "passed",
        Ok(_) => "failed",
        Err(_) => "failed",
    };
    crate::local_db::finish_workflow_run(repo_path, run_id, status)?;
    result
}

/// Executes one job's steps inside an already-open run.
fn run_job_in_run(
    repo_path: &str,
    filename: &str,
    job_id: &str,
    workspace_path: &str,
    run_id: i64,
    position: i64,
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

    let started_at = Utc::now().to_rfc3339();
    let writer = LogWriter::create(repo_path, run_id, job_id)?;
    let log_path = job_log_relative_path(run_id, job_id);

    for (step_index, step) in job_def.steps.iter().enumerate() {
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
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(env_vars) = &step.env {
            for (k, v) in env_vars {
                cmd.env(k, v);
            }
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start step '{}': {}", step.name, e))?;

        // Separate threads per pipe; one reader would deadlock on large output.
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let readers: Vec<_> = [
            ("stdout", stdout.map(EitherPipe::Out)),
            ("stderr", stderr.map(EitherPipe::Err)),
        ]
        .into_iter()
        .filter_map(|(stream_name, pipe)| pipe.map(|p| (stream_name, p)))
        .map(|(stream_name, pipe)| {
            let writer = writer.clone();
            let step_name = step.name.clone();
            std::thread::spawn(move || {
                let reader: Box<dyn std::io::Read + Send> = match pipe {
                    EitherPipe::Out(o) => Box::new(o),
                    EitherPipe::Err(e) => Box::new(e),
                };
                let buf = std::io::BufReader::new(reader);
                for line in buf.lines() {
                    let Ok(raw) = line else { break };
                    let message = strip_ansi(&raw);
                    let entry = LogLine {
                        ts: Utc::now().to_rfc3339(),
                        step_index: step_index as i64,
                        step_name: step_name.clone(),
                        stream: stream_name.to_string(),
                        level: infer_level(&message).to_string(),
                        message,
                    };
                    let _ = writer.write_line(&entry);
                }
            })
        })
        .collect();

        let timeout = Duration::from_secs(STEP_TIMEOUT_SECS);
        let start = Instant::now();
        let timed_out;
        let exit_status = loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    timed_out = false;
                    break Some(status);
                }
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        timed_out = true;
                        break None;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(format!("Failed waiting for step '{}': {}", step.name, e)),
            }
        };

        // Killing the child closes the pipes, so the readers finish on their own.
        for handle in readers {
            let _ = handle.join();
        }

        if timed_out {
            let _ = writer.write_line(&LogLine {
                ts: Utc::now().to_rfc3339(),
                step_index: step_index as i64,
                step_name: step.name.clone(),
                stream: "stderr".to_string(),
                level: "error".to_string(),
                message: format!(
                    "Step timed out after {} seconds and was terminated.",
                    STEP_TIMEOUT_SECS
                ),
            });
            let _ = writer.flush();
            step_results.push(StepResult {
                name: step.name.clone(),
                success: false,
            });
            break;
        }

        let success = exit_status.map(|s| s.success()).unwrap_or(false);
        step_results.push(StepResult {
            name: step.name.clone(),
            success,
        });

        if !success {
            break;
        }
    }

    writer.flush()?;

    let overall_success = step_results.iter().all(|s| s.success);
    let result = JobResult {
        job_id: job_id.to_string(),
        steps: step_results,
        success: overall_success,
    };

    store_job_result(repo_path, run_id, position, &started_at, &log_path, &result)?;

    Ok(result)
}

/// Lets the two pipe types share one reader thread body.
enum EitherPipe {
    Out(std::process::ChildStdout),
    Err(std::process::ChildStderr),
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

    // All jobs share one run row so history shows one item per invocation.
    let job_ids: Vec<String> = wf.jobs.into_iter().map(|j| j.id).collect();
    let total = job_ids.len();
    let run_id = crate::local_db::create_workflow_run(repo_path, workspace_id, filename)?;

    let rp = repo_path.to_string();
    let fn_ = filename.to_string();
    let wp = workspace_path.to_string();

    let (result_tx, result_rx) = std::sync::mpsc::channel::<Result<JobResult, String>>();
    let mut job_iter = job_ids.into_iter().enumerate();
    let mut in_flight = 0usize;
    let mut results = Vec::with_capacity(total);
    let mut failure: Option<String> = None;

    loop {
        // Refill the slot pool up to MAX_CONCURRENT_JOBS.
        while in_flight < MAX_CONCURRENT_JOBS {
            match job_iter.next() {
                Some((position, job_id)) => {
                    let rp = rp.clone();
                    let fn_ = fn_.clone();
                    let wp = wp.clone();
                    let tx = result_tx.clone();
                    std::thread::spawn(move || {
                        let r = run_job_in_run(&rp, &fn_, &job_id, &wp, run_id, position as i64);
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
            // Keep draining so one bad job doesn't abort unrelated jobs.
            Ok(Err(e)) => {
                failure.get_or_insert(e);
                in_flight -= 1;
            }
            Err(_) => {
                failure.get_or_insert_with(|| "Job thread disconnected unexpectedly".to_string());
                in_flight -= 1;
            }
        }
    }

    let status = if failure.is_some() || results.iter().any(|r| !r.success) {
        "failed"
    } else {
        "passed"
    };
    crate::local_db::finish_workflow_run(repo_path, run_id, status)?;

    if let Some(err) = failure {
        return Err(err);
    }

    // Restore workflow job order; completion order is nondeterministic.
    results.sort_by(|a, b| a.job_id.cmp(&b.job_id));
    Ok(results)
}

fn store_job_result(
    repo_path: &str,
    run_id: i64,
    position: i64,
    started_at: &str,
    log_path: &str,
    result: &JobResult,
) -> Result<(), String> {
    let steps_json = serde_json::to_string(&result.steps)
        .map_err(|e| format!("Failed to serialize steps: {}", e))?;
    crate::local_db::add_workflow_job_result(
        repo_path,
        run_id,
        &result.job_id,
        position,
        if result.success { "passed" } else { "failed" },
        started_at,
        &Utc::now().to_rfc3339(),
        &steps_json,
        Some(log_path),
    )?;
    Ok(())
}

// ── Run history and logs ─────────────────────────────────────────────────────

/// A past invocation, with its per-job outcomes, for the run-history list.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunSummary {
    pub id: i64,
    pub filename: String,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub jobs: Vec<RunJobSummary>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunJobSummary {
    pub job_id: String,
    pub status: String,
    pub steps: Vec<StepResult>,
    pub has_logs: bool,
}

pub fn list_workflow_runs_sync(
    repo_path: &str,
    workspace_id: i64,
    filename: &str,
    limit: i64,
) -> Result<Vec<RunSummary>, String> {
    let runs = crate::local_db::list_workflow_runs(repo_path, workspace_id, filename, limit)?;
    let mut summaries = Vec::with_capacity(runs.len());
    for run in runs {
        let job_rows = crate::local_db::list_workflow_job_results(repo_path, run.id)?;
        let jobs = job_rows
            .into_iter()
            .map(|j| RunJobSummary {
                job_id: j.job_id,
                status: j.status,
                steps: serde_json::from_str(&j.steps_json).unwrap_or_default(),
                has_logs: j.log_path.is_some(),
            })
            .collect();
        summaries.push(RunSummary {
            id: run.id,
            filename: run.filename,
            status: run.status,
            started_at: run.started_at,
            completed_at: run.completed_at,
            jobs,
        });
    }
    Ok(summaries)
}

/// Resolve a job's log file to an absolute path, refusing anything that escapes
/// the repo's `.treq/runs` directory.
fn resolve_log_path(repo_path: &str, run_id: i64, job_id: &str) -> Result<String, String> {
    let relative = crate::local_db::get_job_log_path(repo_path, run_id, job_id)?
        .ok_or_else(|| format!("No logs recorded for job '{}' in run {}", job_id, run_id))?;
    let absolute = Path::new(repo_path).join(&relative);

    let runs_root = Path::new(repo_path).join(".treq").join("runs");
    let canonical_root = runs_root
        .canonicalize()
        .map_err(|e| format!("Failed to access runs directory: {}", e))?;
    let canonical_file = absolute
        .canonicalize()
        .map_err(|_| format!("Log file missing for job '{}'", job_id))?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err(format!(
            "Log path for job '{}' is outside .treq/runs",
            job_id
        ));
    }
    Ok(canonical_file.to_string_lossy().to_string())
}

pub fn get_run_logs_sync(
    repo_path: &str,
    run_id: i64,
    job_id: &str,
    query: &crate::core::checks_logs::LogQuery,
) -> Result<Vec<LogLine>, String> {
    let path = resolve_log_path(repo_path, run_id, job_id)?;
    crate::core::checks_logs::query_logs(&path, query)
}

pub fn export_run_logs_sync(
    repo_path: &str,
    run_id: i64,
    job_id: &str,
    dest_path: &str,
) -> Result<String, String> {
    let path = resolve_log_path(repo_path, run_id, job_id)?;
    crate::core::checks_logs::export_logs(&path, dest_path)
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
    fn test_run_job_captures_stdout_into_logs() {
        let dir = TempDir::new().unwrap();
        let content = make_workflow(
            "  greet:\n    steps:\n      - name: Say hi\n        run: echo hello-from-step\n",
        );
        let repo = setup_trusted_repo(&dir, "ci.yaml", &content);
        run_workflow_job_sync(&repo, "ci.yaml", "greet", 0, &repo).unwrap();

        let runs = list_workflow_runs_sync(&repo, 0, "ci.yaml", 10).unwrap();
        let logs = get_run_logs_sync(&repo, runs[0].id, "greet", &Default::default()).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].message, "hello-from-step");
    }

    #[test]
    fn test_run_job_captures_stderr_and_marks_error_level() {
        let dir = TempDir::new().unwrap();
        let content = make_workflow(
            "  boom:\n    steps:\n      - name: Fail loudly\n        run: \"echo 'error: something broke' 1>&2; exit 1\"\n",
        );
        let repo = setup_trusted_repo(&dir, "ci.yaml", &content);
        run_workflow_job_sync(&repo, "ci.yaml", "boom", 0, &repo).unwrap();

        let runs = list_workflow_runs_sync(&repo, 0, "ci.yaml", 10).unwrap();
        let logs = get_run_logs_sync(&repo, runs[0].id, "boom", &Default::default()).unwrap();
        assert_eq!(logs[0].stream, "stderr");
        assert_eq!(logs[0].level, "error");
    }

    #[test]
    fn test_rerunning_creates_a_separate_run() {
        let dir = TempDir::new().unwrap();
        let content =
            make_workflow("  greet:\n    steps:\n      - name: Say hi\n        run: echo hi\n");
        let repo = setup_trusted_repo(&dir, "ci.yaml", &content);
        run_workflow_job_sync(&repo, "ci.yaml", "greet", 0, &repo).unwrap();
        run_workflow_job_sync(&repo, "ci.yaml", "greet", 0, &repo).unwrap();

        let runs = list_workflow_runs_sync(&repo, 0, "ci.yaml", 10).unwrap();
        assert_eq!(runs.len(), 2);
        // Newest first, and the older run's logs stay reachable.
        assert!(runs[0].id > runs[1].id);
    }

    #[test]
    fn test_run_workflow_groups_all_jobs_into_one_run() {
        let dir = TempDir::new().unwrap();
        let content = "name: Multi\non:\n  workflow_dispatch: {}\njobs:\n  job1:\n    steps:\n      - name: s1\n        run: echo a\n  job2:\n    steps:\n      - name: s2\n        run: echo b\n";
        let repo = setup_trusted_repo(&dir, "multi.yaml", content);
        run_workflow_sync(&repo, "multi.yaml", 0, &repo).unwrap();

        let runs = list_workflow_runs_sync(&repo, 0, "multi.yaml", 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].jobs.len(), 2);
    }

    #[test]
    fn test_export_run_logs_writes_file() {
        let dir = TempDir::new().unwrap();
        let content = make_workflow(
            "  greet:\n    steps:\n      - name: Say hi\n        run: echo exported-line\n",
        );
        let repo = setup_trusted_repo(&dir, "ci.yaml", &content);
        run_workflow_job_sync(&repo, "ci.yaml", "greet", 0, &repo).unwrap();

        let runs = list_workflow_runs_sync(&repo, 0, "ci.yaml", 10).unwrap();
        let dest = dir.path().join("out.log").to_string_lossy().to_string();
        export_run_logs_sync(&repo, runs[0].id, "greet", &dest).unwrap();
        let contents = fs::read_to_string(&dest).unwrap();
        assert!(contents.contains("exported-line"));
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
