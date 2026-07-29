use crate::core::{JobResult, WorkflowInfo};

#[tauri::command]
pub async fn list_workflows(repo_path: String) -> Result<Vec<WorkflowInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::core::list_workflows_sync(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn run_workflow_job(
    repo_path: String,
    filename: String,
    job_id: String,
    workspace_id: i64,
    workspace_path: String,
) -> Result<JobResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::core::run_workflow_job_sync(&repo_path, &filename, &job_id, workspace_id, &workspace_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn run_workflow(
    repo_path: String,
    filename: String,
    workspace_id: i64,
    workspace_path: String,
) -> Result<Vec<JobResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::core::run_workflow_sync(&repo_path, &filename, workspace_id, &workspace_path)
    })
    .await
    .map_err(|e| e.to_string())?
}
