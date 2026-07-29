use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

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

    let mut workflows = Vec::new();
    for entry in entries {
        let filename = entry.file_name().to_string_lossy().to_string();
        let content = std::fs::read_to_string(entry.path())
            .map_err(|e| format!("Failed to read {}: {}", filename, e))?;
        let wf: WorkflowFile = serde_yaml::from_str(&content)
            .map_err(|e| format!("Failed to parse {}: {}", filename, e))?;

        let mut jobs: Vec<JobInfo> = wf
            .jobs
            .into_iter()
            .map(|(id, def)| JobInfo {
                id: id.clone(),
                name: def.name.unwrap_or_else(|| id),
                steps: def.steps.into_iter().map(|s| StepInfo { name: s.name }).collect(),
            })
            .collect();
        jobs.sort_by(|a, b| a.id.cmp(&b.id));

        workflows.push(WorkflowInfo { filename, name: wf.name, jobs });
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
    let workflows_dir = Path::new(repo_path).join(".treq").join("workflows");
    let file_path = workflows_dir.join(filename);
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))?;
    let wf: WorkflowFile = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", filename, e))?;

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
            Path::new(&base_dir).join(wd).to_string_lossy().to_string()
        } else {
            base_dir.clone()
        };

        let mut cmd = Command::new("sh");
        cmd.args(["-c", &step.run])
            .current_dir(&cwd)
            .env("PATH", &extended_path);

        if let Some(env_vars) = &step.env {
            for (k, v) in env_vars {
                cmd.env(k, v);
            }
        }

        let output = cmd.output().map_err(|e| format!("Failed to run step '{}': {}", step.name, e))?;
        let success = output.status.success();

        step_results.push(StepResult { name: step.name.clone(), success });

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

    let repo_path = repo_path.to_string();
    let filename = filename.to_string();
    let workspace_path = workspace_path.to_string();

    let handles: Vec<_> = job_ids
        .into_iter()
        .map(|job_id| {
            let repo_path = repo_path.clone();
            let filename = filename.clone();
            let workspace_path = workspace_path.clone();
            std::thread::spawn(move || {
                run_workflow_job_sync(&repo_path, &filename, &job_id, workspace_id, &workspace_path)
            })
        })
        .collect();

    let mut results = Vec::new();
    for handle in handles {
        match handle.join() {
            Ok(Ok(result)) => results.push(result),
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err("Job thread panicked".to_string()),
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
    fn test_list_workflows_sorted_by_filename() {
        let dir = TempDir::new().unwrap();
        let content = make_workflow(
            "  j:\n    steps:\n      - name: s\n        run: echo x\n",
        );
        let repo = write_workflow(&dir, "b.yaml", &content);
        write_workflow(&dir, "a.yaml", &content);
        let result = list_workflows_sync(&repo).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result[0].filename < result[1].filename);
    }

    #[test]
    fn test_run_job_success() {
        let dir = TempDir::new().unwrap();
        let content = make_workflow(
            "  greet:\n    steps:\n      - name: Say hi\n        run: echo hi\n",
        );
        let repo = write_workflow(&dir, "ci.yaml", &content);
        let _ = crate::local_db::init_local_db(&repo);
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
        let repo = write_workflow(&dir, "ci.yaml", &content);
        let _ = crate::local_db::init_local_db(&repo);
        let result = run_workflow_job_sync(&repo, "ci.yaml", "check", 0, &repo).unwrap();
        assert!(!result.success);
        assert_eq!(result.steps.len(), 1);
    }

    #[test]
    fn test_run_job_unknown_job_returns_error() {
        let dir = TempDir::new().unwrap();
        let content = make_workflow(
            "  greet:\n    steps:\n      - name: hi\n        run: echo hi\n",
        );
        let repo = write_workflow(&dir, "ci.yaml", &content);
        let err = run_workflow_job_sync(&repo, "ci.yaml", "nonexistent", 0, &repo).unwrap_err();
        assert!(err.contains("nonexistent"));
    }

    #[test]
    fn test_run_job_env_vars() {
        let dir = TempDir::new().unwrap();
        let content = "name: Env Test\non:\n  workflow_dispatch: {}\njobs:\n  check:\n    steps:\n      - name: Check env\n        run: test \"$MY_VAR\" = \"hello\"\n        env:\n          MY_VAR: hello\n";
        let repo = write_workflow(&dir, "env.yaml", content);
        let _ = crate::local_db::init_local_db(&repo);
        let result = run_workflow_job_sync(&repo, "env.yaml", "check", 0, &repo).unwrap();
        assert!(result.success);
    }

    #[test]
    fn test_run_workflow_runs_all_jobs() {
        let dir = TempDir::new().unwrap();
        let content = "name: Multi\non:\n  workflow_dispatch: {}\njobs:\n  job1:\n    steps:\n      - name: s1\n        run: echo a\n  job2:\n    steps:\n      - name: s2\n        run: echo b\n";
        let repo = write_workflow(&dir, "multi.yaml", content);
        let _ = crate::local_db::init_local_db(&repo);
        let results = run_workflow_sync(&repo, "multi.yaml", 0, &repo).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.success));
    }
}
