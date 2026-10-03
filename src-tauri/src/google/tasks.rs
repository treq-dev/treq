//! Google Tasks.

use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GoogleTaskList {
  pub id: String,
  pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GoogleTask {
  pub id: String,
  pub list_id: String,
  pub title: String,
  pub notes: Option<String>,
  /// `"needsAction"` or `"completed"`.
  pub status: String,
  /// RFC 3339 date; Google only keeps the date part.
  pub due: Option<String>,
  pub parent: Option<String>,
  /// Lexicographic sort key Google assigns within a list.
  pub position: String,
  pub web_link: Option<String>,
}

pub(crate) fn str_field(v: &Value, key: &str) -> Option<String> {
  v.get(key).and_then(Value::as_str).map(str::to_string)
}

pub fn map_task(list_id: &str, v: &Value) -> Option<GoogleTask> {
  Some(GoogleTask {
    id: str_field(v, "id")?,
    list_id: list_id.to_string(),
    title: str_field(v, "title").unwrap_or_default(),
    notes: str_field(v, "notes").filter(|n| !n.is_empty()),
    status: str_field(v, "status").unwrap_or_else(|| "needsAction".to_string()),
    due: str_field(v, "due"),
    parent: str_field(v, "parent"),
    position: str_field(v, "position").unwrap_or_default(),
    web_link: str_field(v, "webViewLink"),
  })
}

pub async fn list_task_lists(source: &GoogleSource) -> Result<Vec<GoogleTaskList>, String> {
  let value = send_json(
    source,
    reqwest::Method::GET,
    &format!("{TASKS_API}/users/@me/lists?maxResults=100"),
    None,
  )
  .await?;
  Ok(
    value
      .get("items")
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
      .filter_map(|v| {
        Some(GoogleTaskList {
          id: str_field(v, "id")?,
          title: str_field(v, "title").unwrap_or_default(),
        })
      })
      .collect(),
  )
}

pub async fn list_tasks(source: &GoogleSource, list_id: &str) -> Result<Vec<GoogleTask>, String> {
  let mut tasks = Vec::new();
  let mut page_token: Option<String> = None;
  loop {
    let mut url = format!(
      "{TASKS_API}/lists/{}/tasks?maxResults=100&showCompleted=true&showHidden=true",
      seg(list_id)
    );
    if let Some(token) = &page_token {
      url.push_str(&format!("&pageToken={}", enc(token)));
    }
    let value = send_json(source, reqwest::Method::GET, &url, None).await?;
    tasks.extend(
      value
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|v| v.get("deleted").and_then(Value::as_bool) != Some(true))
        .filter_map(|v| map_task(list_id, v)),
    );
    page_token = str_field(&value, "nextPageToken");
    if page_token.is_none() {
      break;
    }
  }
  tasks.sort_by(|a, b| a.position.cmp(&b.position));
  Ok(tasks)
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TaskInput {
  pub title: Option<String>,
  pub notes: Option<String>,
  pub status: Option<String>,
  pub due: Option<String>,
  /// On creation only: makes the new task a subtask of this one.
  pub parent: Option<String>,
}

pub(crate) fn task_body(input: &TaskInput) -> Value {
  let mut body = serde_json::Map::new();
  if let Some(title) = &input.title {
    body.insert("title".into(), json!(title));
  }
  if let Some(notes) = &input.notes {
    body.insert("notes".into(), json!(notes));
  }
  if let Some(status) = &input.status {
    body.insert("status".into(), json!(status));
    if status == "needsAction" {
      // Reopening a task needs `completed` cleared as well.
      body.insert("completed".into(), Value::Null);
    }
  }
  if let Some(due) = &input.due {
    body.insert(
      "due".into(),
      if due.is_empty() {
        Value::Null
      } else {
        json!(due)
      },
    );
  }
  Value::Object(body)
}

pub(crate) fn create_task_url(list_id: &str, parent: Option<&str>) -> String {
  let mut url = format!("{TASKS_API}/lists/{}/tasks", seg(list_id));
  if let Some(parent) = parent.filter(|p| !p.is_empty()) {
    url.push_str(&format!("?parent={}", enc(parent)));
  }
  url
}

pub async fn create_task(
  source: &GoogleSource,
  list_id: &str,
  input: &TaskInput,
) -> Result<GoogleTask, String> {
  let value = send_json(
    source,
    reqwest::Method::POST,
    &create_task_url(list_id, input.parent.as_deref()),
    Some(&task_body(input)),
  )
  .await?;
  map_task(list_id, &value).ok_or_else(|| "Google returned an invalid task".to_string())
}

pub async fn update_task(
  source: &GoogleSource,
  list_id: &str,
  task_id: &str,
  input: &TaskInput,
) -> Result<GoogleTask, String> {
  let value = send_json(
    source,
    reqwest::Method::PATCH,
    &format!("{TASKS_API}/lists/{}/tasks/{}", seg(list_id), seg(task_id)),
    Some(&task_body(input)),
  )
  .await?;
  map_task(list_id, &value).ok_or_else(|| "Google returned an invalid task".to_string())
}

pub async fn delete_task(
  source: &GoogleSource,
  list_id: &str,
  task_id: &str,
) -> Result<(), String> {
  send(
    source,
    reqwest::Method::DELETE,
    &format!("{TASKS_API}/lists/{}/tasks/{}", seg(list_id), seg(task_id)),
    None,
  )
  .await
  .map(|_| ())
}

/// Moves a task to another list (a Kanban column) and/or after a sibling.
pub async fn move_task(
  source: &GoogleSource,
  list_id: &str,
  task_id: &str,
  destination_list_id: Option<&str>,
  previous_task_id: Option<&str>,
) -> Result<GoogleTask, String> {
  let mut url = format!(
    "{TASKS_API}/lists/{}/tasks/{}/move?",
    seg(list_id),
    seg(task_id)
  );
  if let Some(dest) = destination_list_id.filter(|d| *d != list_id) {
    url.push_str(&format!("destinationTasklist={}&", enc(dest)));
  }
  if let Some(previous) = previous_task_id {
    url.push_str(&format!("previous={}", enc(previous)));
  }
  let value = send_json(source, reqwest::Method::POST, &url, None).await?;
  let final_list = destination_list_id.unwrap_or(list_id);
  map_task(final_list, &value).ok_or_else(|| "Google returned an invalid task".to_string())
}

pub async fn create_task_list(
  source: &GoogleSource,
  title: &str,
) -> Result<GoogleTaskList, String> {
  let value = send_json(
    source,
    reqwest::Method::POST,
    &format!("{TASKS_API}/users/@me/lists"),
    Some(&json!({ "title": title })),
  )
  .await?;
  Ok(GoogleTaskList {
    id: str_field(&value, "id").ok_or("Google returned an invalid task list")?,
    title: str_field(&value, "title").unwrap_or_default(),
  })
}
