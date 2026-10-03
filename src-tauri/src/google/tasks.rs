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

/// Fetches `url` page by page and returns each page's JSON. Stops at the last
/// page, at a `nextPageToken` already seen (a server loop), or after
/// `max_pages`.
pub(crate) async fn fetch_pages(
  source: &GoogleSource,
  url: &str,
  max_pages: usize,
) -> Result<Vec<Value>, String> {
  let mut pages = Vec::new();
  let mut seen = std::collections::HashSet::new();
  let mut page_token: Option<String> = None;
  while pages.len() < max_pages {
    let page_url = match &page_token {
      Some(token) => format!("{url}&pageToken={}", enc(token)),
      None => url.to_string(),
    };
    let value = send_json(source, reqwest::Method::GET, &page_url, None).await?;
    page_token = str_field(&value, "nextPageToken");
    pages.push(value);
    match &page_token {
      Some(token) if seen.insert(token.clone()) => {}
      _ => break,
    }
  }
  Ok(pages)
}

fn items<'a>(pages: &'a [Value], key: &'a str) -> impl Iterator<Item = &'a Value> + 'a {
  pages.iter().flat_map(move |page| {
    page
      .get(key)
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
  })
}

pub async fn list_task_lists(source: &GoogleSource) -> Result<Vec<GoogleTaskList>, String> {
  let pages = fetch_pages(
    source,
    &format!("{TASKS_API}/users/@me/lists?maxResults=100"),
    MAX_TASK_PAGES,
  )
  .await?;
  Ok(
    items(&pages, "items")
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
  let url = format!(
    "{TASKS_API}/lists/{}/tasks?maxResults=100&showCompleted=true&showHidden=true",
    seg(list_id)
  );
  let pages = fetch_pages(source, &url, MAX_TASK_PAGES).await?;
  let mut tasks: Vec<GoogleTask> = items(&pages, "items")
    .filter(|v| v.get("deleted").and_then(Value::as_bool) != Some(true))
    .filter_map(|v| map_task(list_id, v))
    .collect();
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
  send_raw(
    source,
    reqwest::Method::DELETE,
    &format!("{TASKS_API}/lists/{}/tasks/{}", seg(list_id), seg(task_id)),
    None,
  )
  .await
  .map(|_| ())
}

pub(crate) fn move_task_url(
  list_id: &str,
  task_id: &str,
  destination_list_id: Option<&str>,
  parent: Option<&str>,
  previous_task_id: Option<&str>,
) -> String {
  let mut params = Vec::new();
  if let Some(dest) = destination_list_id.filter(|d| *d != list_id) {
    params.push(format!("destinationTasklist={}", enc(dest)));
  }
  if let Some(parent) = parent.filter(|p| !p.is_empty()) {
    params.push(format!("parent={}", enc(parent)));
  }
  if let Some(previous) = previous_task_id.filter(|p| !p.is_empty()) {
    params.push(format!("previous={}", enc(previous)));
  }
  let mut url = format!(
    "{TASKS_API}/lists/{}/tasks/{}/move",
    seg(list_id),
    seg(task_id)
  );
  if !params.is_empty() {
    url.push('?');
    url.push_str(&params.join("&"));
  }
  url
}

/// Moves a task to another list (a Kanban column), under `parent` and/or
/// after a sibling. Moving to another list brings its subtasks along.
pub async fn move_task(
  source: &GoogleSource,
  list_id: &str,
  task_id: &str,
  destination_list_id: Option<&str>,
  parent: Option<&str>,
  previous_task_id: Option<&str>,
) -> Result<GoogleTask, String> {
  let destination = destination_list_id.filter(|d| *d != list_id);
  // Google may leave subtasks behind in the old list, so note them first.
  let subtasks: Vec<GoogleTask> = match destination {
    Some(_) => list_tasks(source, list_id)
      .await?
      .into_iter()
      .filter(|t| t.parent.as_deref() == Some(task_id))
      .collect(),
    None => Vec::new(),
  };
  let value = send_json(
    source,
    reqwest::Method::POST,
    &move_task_url(list_id, task_id, destination, parent, previous_task_id),
    None,
  )
  .await?;
  let final_list = destination.unwrap_or(list_id);
  let task =
    map_task(final_list, &value).ok_or_else(|| "Google returned an invalid task".to_string())?;
  let mut previous: Option<String> = None;
  for subtask in subtasks {
    let url = move_task_url(
      list_id,
      &subtask.id,
      Some(final_list),
      Some(&task.id),
      previous.as_deref(),
    );
    match send_json(source, reqwest::Method::POST, &url, None).await {
      Ok(_) => previous = Some(subtask.id),
      // Already moved with its parent, or gone: nothing left to fix.
      Err(e) => tracing::warn!("Failed to move subtask {} with its parent: {e}", subtask.id),
    }
  }
  Ok(task)
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
