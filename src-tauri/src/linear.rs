use crate::tracker::{KickoffLedger, KickoffPoller, MAX_KICKOFF_ATTEMPTS};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinearIssue {
  pub id: String,
  pub identifier: String,
  pub title: String,
  pub description: Option<String>,
  pub state: LinearState,
  pub labels: Vec<String>,
  pub branch_name: String,
  pub parent_id: Option<String>,
  pub sub_issue_ids: Vec<String>,
  pub url: String,
  pub assignee: Option<LinearUser>,
  pub priority: i32,
  pub priority_label: String,
  pub project: Option<LinearProjectRef>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinearTeam {
  pub id: String,
  pub name: String,
  pub key: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinearState {
  pub name: String,
  #[serde(rename = "type")]
  pub state_type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinearUser {
  pub id: String,
  pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinearProjectRef {
  pub id: String,
  pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinearProject {
  pub id: String,
  pub name: String,
  pub description: Option<String>,
  pub state: String,
  pub target_date: Option<String>,
  pub progress: f64,
  pub url: String,
  pub lead: Option<LinearUser>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinearDocument {
  pub id: String,
  pub title: String,
  pub content: Option<String>,
  pub url: String,
  pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinearComment {
  pub id: String,
  pub body: String,
  pub user: Option<LinearUser>,
  pub created_at: String,
  /// The excerpt of the document/project body this comment is anchored to,
  /// when Linear reports one (inline "highlight and comment" threads).
  pub quoted_text: Option<String>,
}

pub enum LinearClientSource {
  ApiKey(String),
  ProxyToken,
}

pub fn resolve_linear_client(
  repo_path: &str,
  db: &crate::db::Database,
) -> Result<LinearClientSource, String> {
  let api_key = db
    .get_repo_setting(repo_path, "linear_api_key")
    .map_err(|e| format!("Failed to read linear_api_key setting: {e}"))?;

  if let Some(key) = api_key {
    Ok(LinearClientSource::ApiKey(key))
  } else {
    Ok(LinearClientSource::ProxyToken)
  }
}

#[derive(Deserialize)]
struct LinearGraphqlResponse<T> {
  data: Option<T>,
  errors: Option<Vec<LinearGraphqlError>>,
}

#[derive(Deserialize)]
struct LinearGraphqlError {
  message: String,
}

const LINEAR_GRAPHQL_URL: &str = "https://api.linear.app/graphql";

// reqwest has no default timeout. Without one, a stalled Linear request holds
// the auto-kickoff poller thread forever and stops kickoffs for every repo.
const LINEAR_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const LINEAR_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

// Tests point requests at a local mock server and shorten the timeout.
// `#[tokio::test]` runs on one thread, so a thread-local stays test-scoped.
#[cfg(test)]
thread_local! {
  static TEST_ENDPOINT: std::cell::RefCell<Option<(String, Duration)>> =
    const { std::cell::RefCell::new(None) };
}

fn linear_endpoint() -> (String, Duration) {
  #[cfg(test)]
  if let Some(endpoint) = TEST_ENDPOINT.with(|e| e.borrow().clone()) {
    return endpoint;
  }
  (LINEAR_GRAPHQL_URL.to_string(), LINEAR_REQUEST_TIMEOUT)
}

fn linear_http_client() -> &'static reqwest::Client {
  static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
  CLIENT.get_or_init(|| {
    reqwest::Client::builder()
      .connect_timeout(LINEAR_CONNECT_TIMEOUT)
      .build()
      .unwrap_or_else(|_| reqwest::Client::new())
  })
}

/// Sends one GraphQL request to Linear and returns its `data`. `what` names
/// the resource in error messages ("issues", "teams").
async fn linear_graphql<T: DeserializeOwned>(
  api_key: &str,
  body: &serde_json::Value,
  what: &str,
) -> Result<T, String> {
  let (url, timeout) = linear_endpoint();
  let response = linear_http_client()
    .post(url)
    .timeout(timeout)
    .header("Authorization", api_key)
    .json(body)
    .send()
    .await
    .map_err(|e| {
      if e.is_timeout() {
        format!("Linear request for {what} timed out")
      } else {
        format!("Failed to fetch Linear {what}: {e}")
      }
    })?;

  let status = response.status();
  let text = response
    .text()
    .await
    .map_err(|e| format!("Failed to read Linear response: {e}"))?;
  parse_graphql_response(status, &text)
}

/// Linear reports query errors as a GraphQL `errors` array, often with a 4xx
/// status. Those messages are the most useful, so they win when present. A
/// body that is not GraphQL JSON (a proxy error page, a rate-limit response)
/// falls back to a message built from the HTTP status.
fn parse_graphql_response<T: DeserializeOwned>(
  status: reqwest::StatusCode,
  text: &str,
) -> Result<T, String> {
  let result = match serde_json::from_str::<LinearGraphqlResponse<T>>(text) {
    Ok(result) => result,
    Err(e) if status.is_success() => return Err(format!("Failed to parse Linear response: {e}")),
    Err(_) => return Err(http_status_error(status, text)),
  };

  if let Some(errors) = result.errors.filter(|errors| !errors.is_empty()) {
    return Err(format!(
      "Linear API error: {}",
      errors
        .iter()
        .map(|e| e.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
    ));
  }
  if !status.is_success() {
    return Err(http_status_error(status, text));
  }

  result
    .data
    .ok_or_else(|| "No data in Linear response".to_string())
}

fn http_status_error(status: reqwest::StatusCode, text: &str) -> String {
  match status.as_u16() {
    401 | 403 => {
      format!(
        "Linear rejected the API key ({status}). Check the Linear settings for this repository."
      )
    }
    429 => format!("Linear rate limit reached ({status}). Try again in a minute."),
    _ => {
      let body: String = text.chars().take(300).collect();
      format!("Linear API error ({status}): {body}")
    }
  }
}

#[derive(Deserialize)]
struct LinearIssuesData {
  issues: LinearIssuesConnection,
}

#[derive(Deserialize)]
struct LinearIssuesConnection {
  nodes: Vec<LinearIssueNode>,
  #[serde(default, rename = "pageInfo")]
  page_info: LinearPageInfo,
}

#[derive(Deserialize, Default)]
struct LinearPageInfo {
  #[serde(default, rename = "hasNextPage")]
  has_next_page: bool,
  #[serde(default, rename = "endCursor")]
  end_cursor: Option<String>,
}

#[derive(Deserialize)]
struct LinearIssueNode {
  id: String,
  identifier: String,
  title: String,
  description: Option<String>,
  #[serde(default)]
  state: LinearStateData,
  #[serde(default)]
  labels: LinearLabelsConnection,
  #[serde(rename = "branchName")]
  branch_name: String,
  #[serde(rename = "parent")]
  parent_id: Option<LinearParent>,
  #[serde(default, rename = "children")]
  sub_issues: LinearSubIssuesConnection,
  url: String,
  #[serde(default)]
  assignee: Option<LinearUserNode>,
  #[serde(default)]
  priority: i32,
  #[serde(default, rename = "priorityLabel")]
  priority_label: String,
  #[serde(default)]
  project: Option<LinearProjectRefNode>,
}

#[derive(Deserialize)]
struct LinearUserNode {
  id: String,
  name: String,
}

#[derive(Deserialize)]
struct LinearProjectRefNode {
  id: String,
  name: String,
}

#[derive(Deserialize)]
struct LinearStateData {
  name: String,
  #[serde(rename = "type")]
  state_type: String,
}

impl Default for LinearStateData {
  fn default() -> Self {
    Self {
      name: "Unknown".to_string(),
      state_type: "unknown".to_string(),
    }
  }
}

#[derive(Deserialize, Default)]
struct LinearLabelsConnection {
  nodes: Vec<LinearLabelNode>,
}

#[derive(Deserialize)]
struct LinearLabelNode {
  name: String,
}

#[derive(Deserialize)]
struct LinearParent {
  id: String,
}

#[derive(Deserialize, Default)]
struct LinearSubIssuesConnection {
  nodes: Vec<LinearSubIssueNode>,
}

#[derive(Deserialize)]
struct LinearSubIssueNode {
  id: String,
}

#[derive(Deserialize)]
struct LinearTeamsData {
  teams: LinearTeamsConnection,
}

#[derive(Deserialize)]
struct LinearTeamsConnection {
  nodes: Vec<LinearTeamNode>,
}

#[derive(Deserialize)]
struct LinearTeamNode {
  id: String,
  name: String,
  key: String,
}

pub async fn linear_list_teams_impl(api_key: &str) -> Result<Vec<LinearTeam>, String> {
  let query = r#"query {
    teams(first: 100) {
      nodes {
        id
        name
        key
      }
    }
  }"#;

  let data: LinearTeamsData =
    linear_graphql(api_key, &serde_json::json!({ "query": query }), "teams").await?;

  Ok(
    data
      .teams
      .nodes
      .into_iter()
      .map(|node| LinearTeam {
        id: node.id,
        name: node.name,
        key: node.key,
      })
      .collect(),
  )
}

// Caller-supplied values (team keys, entity IDs) always travel as GraphQL
// variables. Splicing them into the query text lets a quote end the string
// literal and inject query syntax.
const ISSUE_FIELDS: &str = r#"
  id
  identifier
  title
  description
  state { name type }
  labels(first: 50) { nodes { name } }
  branchName
  parent { id }
  children(first: 50) { nodes { id } }
  url
  assignee { id name }
  priority
  priorityLabel
  project { id name }
"#;

const ISSUE_PAGE_SIZE: u32 = 100;
// 10 pages keeps a huge workspace from stalling the panel. Issues come back
// most recently updated first, so the cap drops the stalest ones.
const MAX_ISSUE_PAGES: usize = 10;

/// Linear `IssueFilter` for the issue list. `None` means no filter.
fn team_issue_filter(team_filter: Option<&str>) -> Option<serde_json::Value> {
  team_filter.map(|team| serde_json::json!({ "team": { "key": { "eq": team } } }))
}

fn list_issues_body(filter: Option<&serde_json::Value>, after: Option<&str>) -> serde_json::Value {
  serde_json::json!({
    "query": format!(
      "query($first: Int!, $after: String, $filter: IssueFilter) {{ issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {{ nodes {{ {ISSUE_FIELDS} }} pageInfo {{ hasNextPage endCursor }} }} }}"
    ),
    "variables": {
      "first": ISSUE_PAGE_SIZE,
      "after": after,
      "filter": filter,
    },
  })
}

/// Follows `pageInfo` cursors until Linear reports no next page or the
/// `MAX_ISSUE_PAGES` cap is hit.
async fn fetch_issue_pages(
  api_key: &str,
  filter: Option<&serde_json::Value>,
) -> Result<Vec<LinearIssue>, String> {
  let mut issues = Vec::new();
  let mut after: Option<String> = None;
  for _ in 0..MAX_ISSUE_PAGES {
    let data: LinearIssuesData = linear_graphql(
      api_key,
      &list_issues_body(filter, after.as_deref()),
      "issues",
    )
    .await?;
    let page = data.issues;
    issues.extend(page.nodes.into_iter().map(map_issue_node));
    match next_cursor(page.page_info) {
      Some(cursor) => after = Some(cursor),
      None => return Ok(issues),
    }
  }
  log::warn!(
    "linear: issue list truncated at {} issues",
    MAX_ISSUE_PAGES * ISSUE_PAGE_SIZE as usize
  );
  Ok(issues)
}

fn next_cursor(page_info: LinearPageInfo) -> Option<String> {
  page_info
    .has_next_page
    .then_some(page_info.end_cursor)
    .flatten()
}

fn get_issue_body(issue_id: &str) -> serde_json::Value {
  serde_json::json!({
    "query": format!("query($id: String!) {{ issue(id: $id) {{ {ISSUE_FIELDS} }} }}"),
    "variables": { "id": issue_id },
  })
}

fn project_documents_body(project_id: &str) -> serde_json::Value {
  serde_json::json!({
    "query": r#"query($id: String!) {
      project(id: $id) {
        documents(first: 100) {
          nodes {
            id
            title
            content
            url
            updatedAt
          }
        }
      }
    }"#,
    "variables": { "id": project_id },
  })
}

#[derive(Clone, Copy)]
enum CommentEntity {
  Issue,
  Project,
  Document,
}

impl CommentEntity {
  fn field(self) -> &'static str {
    match self {
      CommentEntity::Issue => "issue",
      CommentEntity::Project => "project",
      CommentEntity::Document => "document",
    }
  }
}

fn entity_comments_body(entity: CommentEntity, entity_id: &str) -> serde_json::Value {
  let field = entity.field();
  serde_json::json!({
    "query": format!(
      "query($id: String!) {{ {field}(id: $id) {{ comments(first: 100) {{ nodes {{ id body user {{ id name }} createdAt quotedText }} }} }} }}"
    ),
    "variables": { "id": entity_id },
  })
}

pub async fn linear_list_issues_impl(
  api_key: &str,
  team_filter: Option<&str>,
) -> Result<Vec<LinearIssue>, String> {
  fetch_issue_pages(api_key, team_issue_filter(team_filter).as_ref()).await
}

fn map_issue_node(node: LinearIssueNode) -> LinearIssue {
  LinearIssue {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description,
    state: LinearState {
      name: node.state.name,
      state_type: node.state.state_type,
    },
    labels: node.labels.nodes.into_iter().map(|l| l.name).collect(),
    branch_name: node.branch_name,
    parent_id: node.parent_id.map(|p| p.id),
    sub_issue_ids: node.sub_issues.nodes.into_iter().map(|s| s.id).collect(),
    url: node.url,
    assignee: node.assignee.map(|a| LinearUser {
      id: a.id,
      name: a.name,
    }),
    priority: node.priority,
    priority_label: node.priority_label,
    project: node.project.map(|p| LinearProjectRef {
      id: p.id,
      name: p.name,
    }),
  }
}

pub async fn linear_get_issue_impl(api_key: &str, issue_id: &str) -> Result<LinearIssue, String> {
  #[derive(Deserialize)]
  struct IssueData {
    issue: Option<LinearIssueNode>,
  }

  let data: IssueData = linear_graphql(api_key, &get_issue_body(issue_id), "issue").await?;
  let node = data
    .issue
    .ok_or_else(|| format!("Issue {issue_id} not found"))?;

  Ok(map_issue_node(node))
}

pub async fn linear_get_viewer_impl(api_key: &str) -> Result<LinearUser, String> {
  let query = r#"query { viewer { id name } }"#;

  #[derive(Deserialize)]
  struct ViewerData {
    viewer: LinearUserNode,
  }

  let data: ViewerData =
    linear_graphql(api_key, &serde_json::json!({ "query": query }), "viewer").await?;

  Ok(LinearUser {
    id: data.viewer.id,
    name: data.viewer.name,
  })
}

pub async fn linear_list_projects_impl(api_key: &str) -> Result<Vec<LinearProject>, String> {
  let query = r#"query {
    projects(first: 100) {
      nodes {
        id
        name
        description
        state
        targetDate
        progress
        url
        lead { id name }
      }
    }
  }"#;

  #[derive(Deserialize)]
  struct ProjectsData {
    projects: ProjectsConnection,
  }

  #[derive(Deserialize)]
  struct ProjectsConnection {
    nodes: Vec<ProjectNode>,
  }

  #[derive(Deserialize)]
  struct ProjectNode {
    id: String,
    name: String,
    description: Option<String>,
    state: String,
    #[serde(rename = "targetDate")]
    target_date: Option<String>,
    #[serde(default)]
    progress: f64,
    url: String,
    #[serde(default)]
    lead: Option<LinearUserNode>,
  }

  let data: ProjectsData =
    linear_graphql(api_key, &serde_json::json!({ "query": query }), "projects").await?;

  Ok(
    data
      .projects
      .nodes
      .into_iter()
      .map(|node| LinearProject {
        id: node.id,
        name: node.name,
        description: node.description,
        state: node.state,
        target_date: node.target_date,
        progress: node.progress,
        url: node.url,
        lead: node.lead.map(|l| LinearUser {
          id: l.id,
          name: l.name,
        }),
      })
      .collect(),
  )
}

pub async fn linear_list_project_documents_impl(
  api_key: &str,
  project_id: &str,
) -> Result<Vec<LinearDocument>, String> {
  #[derive(Deserialize)]
  struct ProjectDocumentsData {
    project: Option<ProjectDocumentsNode>,
  }

  #[derive(Deserialize)]
  struct ProjectDocumentsNode {
    documents: DocumentsConnection,
  }

  #[derive(Deserialize)]
  struct DocumentsConnection {
    nodes: Vec<DocumentNode>,
  }

  #[derive(Deserialize)]
  struct DocumentNode {
    id: String,
    title: String,
    content: Option<String>,
    url: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
  }

  let data: ProjectDocumentsData =
    linear_graphql(api_key, &project_documents_body(project_id), "documents").await?;
  let project = data
    .project
    .ok_or_else(|| format!("Project {project_id} not found"))?;

  Ok(
    project
      .documents
      .nodes
      .into_iter()
      .map(|node| LinearDocument {
        id: node.id,
        title: node.title,
        content: node.content,
        url: node.url,
        updated_at: node.updated_at,
      })
      .collect(),
  )
}

#[derive(Deserialize)]
struct CommentNode {
  id: String,
  body: String,
  #[serde(default)]
  user: Option<LinearUserNode>,
  #[serde(rename = "createdAt")]
  created_at: String,
  #[serde(default, rename = "quotedText")]
  quoted_text: Option<String>,
}

#[derive(Deserialize)]
struct CommentsConnection {
  nodes: Vec<CommentNode>,
}

fn map_comment_node(node: CommentNode) -> LinearComment {
  LinearComment {
    id: node.id,
    body: node.body,
    user: node.user.map(|u| LinearUser {
      id: u.id,
      name: u.name,
    }),
    created_at: node.created_at,
    quoted_text: node.quoted_text,
  }
}

async fn fetch_comments_for_entity(
  api_key: &str,
  entity: CommentEntity,
  entity_id: &str,
) -> Result<Vec<LinearComment>, String> {
  let entity_field = entity.field();
  #[derive(Deserialize)]
  struct EntityCommentsData {
    #[serde(flatten)]
    entity: HashMap<String, Option<EntityCommentsNode>>,
  }

  #[derive(Deserialize)]
  struct EntityCommentsNode {
    comments: CommentsConnection,
  }

  let mut data: EntityCommentsData = linear_graphql(
    api_key,
    &entity_comments_body(entity, entity_id),
    "comments",
  )
  .await?;
  let node = data
    .entity
    .remove(entity_field)
    .flatten()
    .ok_or_else(|| format!("{entity_field} {entity_id} not found"))?;

  Ok(
    node
      .comments
      .nodes
      .into_iter()
      .map(map_comment_node)
      .collect(),
  )
}

pub async fn linear_list_issue_comments_impl(
  api_key: &str,
  issue_id: &str,
) -> Result<Vec<LinearComment>, String> {
  fetch_comments_for_entity(api_key, CommentEntity::Issue, issue_id).await
}

pub async fn linear_list_project_comments_impl(
  api_key: &str,
  project_id: &str,
) -> Result<Vec<LinearComment>, String> {
  fetch_comments_for_entity(api_key, CommentEntity::Project, project_id).await
}

pub async fn linear_list_document_comments_impl(
  api_key: &str,
  document_id: &str,
) -> Result<Vec<LinearComment>, String> {
  fetch_comments_for_entity(api_key, CommentEntity::Document, document_id).await
}

fn poll_linear_kickoff(repo_path: &str) -> Result<(), String> {
  let db = crate::tracker::open_app_db()?;

  if !crate::core::feature_preview::is_enabled(
    &db,
    crate::core::feature_preview::PreviewFeature::LinearIntegration,
  ) {
    return Ok(());
  }

  let label = db
    .get_repo_setting(repo_path, "linear_auto_kickoff_label")
    .map_err(|e| format!("Failed to read linear_auto_kickoff_label: {e}"))?;

  let label = match label {
    Some(l) if !l.is_empty() => l,
    _ => return Ok(()),
  };

  let client_source = resolve_linear_client(repo_path, &db)?;
  let api_key = match client_source {
    LinearClientSource::ApiKey(key) => key,
    LinearClientSource::ProxyToken => {
      return Err("Linear auto-kickoff requires API key (OAuth proxy not ready)".to_string())
    }
  };

  let rt =
    tokio::runtime::Runtime::new().map_err(|e| format!("Failed to create async runtime: {e}"))?;

  let issues = rt.block_on(linear_list_issues_impl(&api_key, None))?;
  let labeled_ids: Vec<String> = issues
    .into_iter()
    .filter(|issue| issue.labels.contains(&label))
    .map(|issue| issue.id)
    .collect();

  let mut ledger = KickoffLedger::load(&db, repo_path, HANDLED_KEY, FAILURES_KEY)?;
  for issue_id in ledger.due(&labeled_ids) {
    match rt.block_on(kickoff_linear_issue_internal(
      &db, repo_path, &api_key, &issue_id, false,
    )) {
      Ok(_) => ledger.record_success(&issue_id),
      Err(e) => {
        let attempts = ledger.record_failure(&issue_id);
        log::warn!(
          "linear-kickoff: attempt {attempts}/{MAX_KICKOFF_ATTEMPTS} failed for {issue_id}: {e}"
        );
      }
    }
  }
  ledger.save(&db, repo_path, HANDLED_KEY, FAILURES_KEY)
}

const HANDLED_KEY: &str = "linear_handled_issue_ids";
const FAILURES_KEY: &str = "linear_kickoff_failures";

async fn kickoff_linear_issue_internal(
  db: &crate::db::Database,
  repo_path: &str,
  api_key: &str,
  issue_id: &str,
  include_subissues: bool,
) -> Result<Vec<crate::commands::linear::LinearKickoffResult>, String> {
  let issue = linear_get_issue_impl(api_key, issue_id).await?;
  let mut results = vec![];

  let workspace_result =
    crate::commands::linear::open_or_create_workspace_from_linear_issue(repo_path, &issue).await?;
  results.push(workspace_result);

  if include_subissues && !issue.sub_issue_ids.is_empty() {
    for sub_id in &issue.sub_issue_ids {
      match linear_get_issue_impl(api_key, sub_id).await {
        Ok(sub_issue) => match crate::commands::linear::open_or_create_workspace_from_linear_issue(
          repo_path, &sub_issue,
        )
        .await
        {
          Ok(result) => {
            if result.created {
              if let Err(e) = crate::commands::linear::record_linear_workspace_parent(
                db,
                repo_path,
                result.workspace_id,
                issue_id,
              ) {
                log::warn!("linear-kickoff: failed to record parent for sub-issue {sub_id}: {e}");
              }
            }
            results.push(result);
          }
          Err(e) => log::warn!("linear-kickoff: failed to kickoff sub-issue {sub_id}: {e}"),
        },
        Err(e) => log::warn!("linear-kickoff: failed to fetch sub-issue {sub_id}: {e}"),
      }
    }
  }

  Ok(results)
}

static GLOBAL_KICKOFF_POLLER: std::sync::OnceLock<KickoffPoller> = std::sync::OnceLock::new();

pub fn kickoff_poller() -> &'static KickoffPoller {
  GLOBAL_KICKOFF_POLLER.get_or_init(|| KickoffPoller::new("linear", poll_linear_kickoff))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn deserialize_linear_issue_response() {
    let json = serde_json::json!({
      "id": "ENG-1",
      "identifier": "ENG-1",
      "title": "Test Issue",
      "description": "Test description",
      "state": { "name": "In Progress", "type": "started" },
      "labels": { "nodes": [{ "name": "bug" }] },
      "branchName": "eng-1-test",
      "parent": null,
      "children": { "nodes": [] },
      "url": "https://linear.app/issue/ENG-1"
    });

    let node: LinearIssueNode = serde_json::from_value(json).unwrap();
    assert_eq!(node.identifier, "ENG-1");
    assert_eq!(node.title, "Test Issue");
    assert_eq!(node.state.name, "In Progress");
    assert_eq!(node.state.state_type, "started");
    assert_eq!(node.labels.nodes.len(), 1);
    assert_eq!(node.labels.nodes[0].name, "bug");
    assert_eq!(node.branch_name, "eng-1-test");
  }

  #[test]
  fn deserialize_linear_issue_with_subissues() {
    let json = serde_json::json!({
      "id": "ENG-1",
      "identifier": "ENG-1",
      "title": "Parent Issue",
      "description": null,
      "state": { "name": "Backlog", "type": "backlog" },
      "labels": { "nodes": [] },
      "branchName": "eng-1",
      "parent": null,
      "children": { "nodes": [{ "id": "ENG-2" }, { "id": "ENG-3" }] },
      "url": "https://linear.app/issue/ENG-1"
    });

    let node: LinearIssueNode = serde_json::from_value(json).unwrap();
    assert_eq!(node.sub_issues.nodes.len(), 2);
    assert_eq!(node.sub_issues.nodes[0].id, "ENG-2");
    assert_eq!(node.sub_issues.nodes[1].id, "ENG-3");
  }

  #[test]
  fn deserialize_linear_issue_response_with_parent() {
    let json = serde_json::json!({
      "id": "ENG-2",
      "identifier": "ENG-2",
      "title": "Child Issue",
      "description": null,
      "state": { "name": "Todo", "type": "backlog" },
      "labels": { "nodes": [] },
      "branchName": "eng-2",
      "parent": { "id": "ENG-1" },
      "children": { "nodes": [] },
      "url": "https://linear.app/issue/ENG-2"
    });

    let node: LinearIssueNode = serde_json::from_value(json).unwrap();
    assert_eq!(node.parent_id.unwrap().id, "ENG-1");
  }

  // Spliced into query text, this would close the string literal and inject syntax.
  const HOSTILE: &str = r#"ENG"}) { nodes { id } } #"#;

  #[test]
  fn list_issues_body_passes_team_as_variable() {
    let filter = team_issue_filter(Some(HOSTILE));
    let body = list_issues_body(filter.as_ref(), None);
    assert!(!body["query"].as_str().unwrap().contains(HOSTILE));
    assert_eq!(body["variables"]["filter"]["team"]["key"]["eq"], HOSTILE);
  }

  #[test]
  fn list_issues_body_sends_null_filter_when_unset() {
    let body = list_issues_body(team_issue_filter(None).as_ref(), None);
    assert!(body["variables"]["filter"].is_null());
    assert!(body["variables"]["after"].is_null());
  }

  #[test]
  fn list_issues_body_passes_cursor_as_variable() {
    let body = list_issues_body(None, Some(HOSTILE));
    assert!(!body["query"].as_str().unwrap().contains(HOSTILE));
    assert_eq!(body["variables"]["after"], HOSTILE);
    assert!(body["query"]
      .as_str()
      .unwrap()
      .contains("pageInfo { hasNextPage endCursor }"));
  }

  #[test]
  fn next_cursor_stops_on_last_page() {
    let more = LinearPageInfo {
      has_next_page: true,
      end_cursor: Some("c1".into()),
    };
    assert_eq!(next_cursor(more).as_deref(), Some("c1"));
    let last = LinearPageInfo {
      has_next_page: false,
      end_cursor: Some("c2".into()),
    };
    assert_eq!(next_cursor(last), None);
    // A missing cursor must stop paging rather than refetch page one forever.
    let broken = LinearPageInfo {
      has_next_page: true,
      end_cursor: None,
    };
    assert_eq!(next_cursor(broken), None);
  }

  #[test]
  fn get_issue_body_passes_id_as_variable() {
    let body = get_issue_body(HOSTILE);
    assert!(!body["query"].as_str().unwrap().contains(HOSTILE));
    assert_eq!(body["variables"]["id"], HOSTILE);
  }

  #[test]
  fn project_documents_body_passes_id_as_variable() {
    let body = project_documents_body(HOSTILE);
    assert!(!body["query"].as_str().unwrap().contains(HOSTILE));
    assert_eq!(body["variables"]["id"], HOSTILE);
  }

  #[test]
  fn entity_comments_body_passes_id_as_variable() {
    let body = entity_comments_body(CommentEntity::Document, HOSTILE);
    let query = body["query"].as_str().unwrap();
    assert!(!query.contains(HOSTILE));
    assert!(query.contains("document(id: $id)"));
    assert_eq!(body["variables"]["id"], HOSTILE);
  }

  #[derive(Deserialize, Debug)]
  struct ViewerOnly {
    viewer: TestUser,
  }

  #[derive(Deserialize, Debug)]
  struct TestUser {
    id: String,
  }

  #[test]
  fn graphql_response_returns_data_on_success() {
    let data: ViewerOnly = parse_graphql_response(
      reqwest::StatusCode::OK,
      r#"{"data":{"viewer":{"id":"u1","name":"Ada"}}}"#,
    )
    .unwrap();
    assert_eq!(data.viewer.id, "u1");
  }

  #[test]
  fn graphql_errors_win_over_http_status() {
    let err = parse_graphql_response::<ViewerOnly>(
      reqwest::StatusCode::BAD_REQUEST,
      r#"{"errors":[{"message":"Argument Validation Error"}]}"#,
    )
    .unwrap_err();
    assert_eq!(err, "Linear API error: Argument Validation Error");
  }

  #[test]
  fn non_json_error_body_reports_http_status() {
    let err = parse_graphql_response::<ViewerOnly>(
      reqwest::StatusCode::UNAUTHORIZED,
      "<html>Unauthorized</html>",
    )
    .unwrap_err();
    assert!(err.contains("rejected the API key"), "{err}");

    let err =
      parse_graphql_response::<ViewerOnly>(reqwest::StatusCode::TOO_MANY_REQUESTS, "slow down")
        .unwrap_err();
    assert!(err.contains("rate limit"), "{err}");
  }

  #[test]
  fn error_status_without_graphql_errors_is_not_success() {
    let err =
      parse_graphql_response::<ViewerOnly>(reqwest::StatusCode::BAD_GATEWAY, r#"{"data":null}"#)
        .unwrap_err();
    assert!(err.contains("502"), "{err}");
  }

  struct TestEndpointGuard;

  impl Drop for TestEndpointGuard {
    fn drop(&mut self) {
      TEST_ENDPOINT.with(|e| *e.borrow_mut() = None);
    }
  }

  fn use_mock_endpoint(server: &wiremock::MockServer, timeout: Duration) -> TestEndpointGuard {
    TEST_ENDPOINT.with(|e| *e.borrow_mut() = Some((server.uri(), timeout)));
    TestEndpointGuard
  }

  #[tokio::test]
  async fn stalled_linear_request_times_out() {
    use wiremock::{matchers::method, Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .respond_with(
        ResponseTemplate::new(200)
          .set_body_string(r#"{"data":{"viewer":{"id":"u1","name":"Ada"}}}"#)
          .set_delay(Duration::from_secs(5)),
      )
      .mount(&server)
      .await;
    let _guard = use_mock_endpoint(&server, Duration::from_millis(200));

    let result = tokio::time::timeout(
      Duration::from_secs(3),
      linear_get_viewer_impl("lin_api_test"),
    )
    .await
    .expect("the request must fail on its own timeout, not hang");
    let err = result.expect_err("a stalled request is an error");
    assert!(err.contains("timed out"), "{err}");
  }

  #[tokio::test]
  async fn unauthorized_html_response_reports_the_api_key() {
    use wiremock::{matchers::method, Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .respond_with(ResponseTemplate::new(401).set_body_string("<html>Unauthorized</html>"))
      .mount(&server)
      .await;
    let _guard = use_mock_endpoint(&server, Duration::from_secs(5));

    let err = linear_get_viewer_impl("lin_api_bad").await.unwrap_err();
    assert!(err.contains("rejected the API key"), "{err}");
  }

  #[tokio::test]
  async fn api_key_is_sent_bare_in_authorization_header() {
    use wiremock::{
      matchers::{header, method},
      Mock, MockServer, ResponseTemplate,
    };
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(header("authorization", "lin_api_test"))
      .respond_with(
        ResponseTemplate::new(200)
          .set_body_string(r#"{"data":{"viewer":{"id":"u1","name":"Ada"}}}"#),
      )
      .expect(1)
      .mount(&server)
      .await;
    let _guard = use_mock_endpoint(&server, Duration::from_secs(5));

    let viewer = linear_get_viewer_impl("lin_api_test").await.unwrap();
    assert_eq!(viewer.id, "u1");
  }

  fn issue_page(ids: &[&str], next: Option<&str>) -> serde_json::Value {
    let nodes: Vec<_> = ids
      .iter()
      .map(|id| {
        serde_json::json!({
          "id": id,
          "identifier": id.to_uppercase(),
          "title": format!("Issue {id}"),
          "branchName": format!("branch-{id}"),
          "url": format!("https://linear.app/t/issue/{id}"),
        })
      })
      .collect();
    serde_json::json!({
      "data": { "issues": {
        "nodes": nodes,
        "pageInfo": { "hasNextPage": next.is_some(), "endCursor": next },
      } }
    })
  }

  #[tokio::test]
  async fn list_issues_follows_cursors_past_the_first_page() {
    use wiremock::{
      matchers::{body_partial_json, method},
      Mock, MockServer, ResponseTemplate,
    };
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .and(body_partial_json(
        serde_json::json!({ "variables": { "after": "c1" } }),
      ))
      .respond_with(ResponseTemplate::new(200).set_body_json(issue_page(&["b"], None)))
      .with_priority(1)
      .expect(1)
      .mount(&server)
      .await;
    Mock::given(method("POST"))
      .respond_with(ResponseTemplate::new(200).set_body_json(issue_page(&["a"], Some("c1"))))
      .with_priority(2)
      .mount(&server)
      .await;
    let _guard = use_mock_endpoint(&server, Duration::from_secs(5));

    let issues = linear_list_issues_impl("lin_api_test", Some("ENG"))
      .await
      .unwrap();
    let ids: Vec<_> = issues.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(ids, ["a", "b"]);
  }

  #[tokio::test]
  async fn list_issues_stops_at_the_page_cap() {
    use wiremock::{matchers::method, Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("POST"))
      .respond_with(ResponseTemplate::new(200).set_body_json(issue_page(&["x"], Some("again"))))
      .expect(MAX_ISSUE_PAGES as u64)
      .mount(&server)
      .await;
    let _guard = use_mock_endpoint(&server, Duration::from_secs(5));

    let issues = linear_list_issues_impl("lin_api_test", None).await.unwrap();
    assert_eq!(issues.len(), MAX_ISSUE_PAGES);
  }
}
