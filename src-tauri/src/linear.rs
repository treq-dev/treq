use crate::lock_ext::LockExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
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

#[derive(Deserialize)]
struct LinearIssuesData {
  issues: LinearIssuesConnection,
}

#[derive(Deserialize)]
struct LinearIssuesConnection {
  nodes: Vec<LinearIssueNode>,
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

  let client = reqwest::Client::new();
  let response = client
    .post("https://api.linear.app/graphql")
    .header("Authorization", api_key)
    .json(&serde_json::json!({ "query": query }))
    .send()
    .await
    .map_err(|e| format!("Failed to fetch Linear teams: {e}"))?;

  let result: LinearGraphqlResponse<LinearTeamsData> = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

  if let Some(errors) = result.errors {
    return Err(format!(
      "Linear API error: {}",
      errors
        .iter()
        .map(|e| e.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
    ));
  }

  let data = result
    .data
    .ok_or_else(|| "No data in Linear response".to_string())?;

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

fn list_issues_body(team_filter: Option<&str>) -> serde_json::Value {
  match team_filter {
    Some(team) => serde_json::json!({
      "query": format!(
        "query($team: String!) {{ issues(first: 100, filter: {{ team: {{ key: {{ eq: $team }} }} }}) {{ nodes {{ {ISSUE_FIELDS} }} }} }}"
      ),
      "variables": { "team": team },
    }),
    None => serde_json::json!({
      "query": format!("query {{ issues(first: 100) {{ nodes {{ {ISSUE_FIELDS} }} }} }}"),
    }),
  }
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
  let client = reqwest::Client::new();
  let response = client
    .post("https://api.linear.app/graphql")
    .header("Authorization", api_key)
    .json(&list_issues_body(team_filter))
    .send()
    .await
    .map_err(|e| format!("Failed to fetch Linear issues: {e}"))?;

  let result: LinearGraphqlResponse<LinearIssuesData> = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

  if let Some(errors) = result.errors {
    return Err(format!(
      "Linear API error: {}",
      errors
        .iter()
        .map(|e| e.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
    ));
  }

  let data = result
    .data
    .ok_or_else(|| "No data in Linear response".to_string())?;

  Ok(data.issues.nodes.into_iter().map(map_issue_node).collect())
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
  let client = reqwest::Client::new();
  let response = client
    .post("https://api.linear.app/graphql")
    .header("Authorization", api_key)
    .json(&get_issue_body(issue_id))
    .send()
    .await
    .map_err(|e| format!("Failed to fetch Linear issue: {e}"))?;

  #[derive(Deserialize)]
  struct IssueData {
    issue: Option<LinearIssueNode>,
  }

  let result: LinearGraphqlResponse<IssueData> = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

  if let Some(errors) = result.errors {
    return Err(format!(
      "Linear API error: {}",
      errors
        .iter()
        .map(|e| e.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
    ));
  }

  let data = result
    .data
    .ok_or_else(|| "No data in Linear response".to_string())?;
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

  let client = reqwest::Client::new();
  let response = client
    .post("https://api.linear.app/graphql")
    .header("Authorization", api_key)
    .json(&serde_json::json!({ "query": query }))
    .send()
    .await
    .map_err(|e| format!("Failed to fetch Linear viewer: {e}"))?;

  let result: LinearGraphqlResponse<ViewerData> = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

  if let Some(errors) = result.errors {
    return Err(format!(
      "Linear API error: {}",
      errors
        .iter()
        .map(|e| e.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
    ));
  }

  let data = result
    .data
    .ok_or_else(|| "No data in Linear response".to_string())?;

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

  let client = reqwest::Client::new();
  let response = client
    .post("https://api.linear.app/graphql")
    .header("Authorization", api_key)
    .json(&serde_json::json!({ "query": query }))
    .send()
    .await
    .map_err(|e| format!("Failed to fetch Linear projects: {e}"))?;

  let result: LinearGraphqlResponse<ProjectsData> = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

  if let Some(errors) = result.errors {
    return Err(format!(
      "Linear API error: {}",
      errors
        .iter()
        .map(|e| e.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
    ));
  }

  let data = result
    .data
    .ok_or_else(|| "No data in Linear response".to_string())?;

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

  let client = reqwest::Client::new();
  let response = client
    .post("https://api.linear.app/graphql")
    .header("Authorization", api_key)
    .json(&project_documents_body(project_id))
    .send()
    .await
    .map_err(|e| format!("Failed to fetch Linear documents: {e}"))?;

  let result: LinearGraphqlResponse<ProjectDocumentsData> = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

  if let Some(errors) = result.errors {
    return Err(format!(
      "Linear API error: {}",
      errors
        .iter()
        .map(|e| e.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
    ));
  }

  let data = result
    .data
    .ok_or_else(|| "No data in Linear response".to_string())?;
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

  let client = reqwest::Client::new();
  let response = client
    .post("https://api.linear.app/graphql")
    .header("Authorization", api_key)
    .json(&entity_comments_body(entity, entity_id))
    .send()
    .await
    .map_err(|e| format!("Failed to fetch Linear comments: {e}"))?;

  let result: LinearGraphqlResponse<EntityCommentsData> = response
    .json()
    .await
    .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

  if let Some(errors) = result.errors {
    return Err(format!(
      "Linear API error: {}",
      errors
        .iter()
        .map(|e| e.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
    ));
  }

  let mut data = result
    .data
    .ok_or_else(|| "No data in Linear response".to_string())?;
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

const KICKOFF_POLL_INTERVAL: Duration = Duration::from_secs(60);

struct LinearAutoKickoffInner {
  watched: Mutex<std::collections::HashSet<String>>,
  shutdown: AtomicBool,
  loop_started: AtomicBool,
  wake: (Mutex<()>, std::sync::Condvar),
}

pub struct LinearAutoKickoffPoller {
  inner: Arc<LinearAutoKickoffInner>,
}

impl LinearAutoKickoffPoller {
  #[allow(clippy::new_without_default)]
  pub fn new() -> Self {
    Self {
      inner: Arc::new(LinearAutoKickoffInner {
        watched: Mutex::new(std::collections::HashSet::new()),
        shutdown: AtomicBool::new(false),
        loop_started: AtomicBool::new(false),
        wake: (Mutex::new(()), std::sync::Condvar::new()),
      }),
    }
  }

  pub fn ensure_started(&self) {
    if self
      .inner
      .loop_started
      .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
      .is_err()
    {
      return;
    }
    let inner = Arc::clone(&self.inner);
    thread::Builder::new()
      .name("linear-kickoff-poller".into())
      .spawn(move || kickoff_background_loop(inner))
      .expect("failed to spawn linear-kickoff-poller thread");
  }

  pub fn watch_repo(&self, repo_path: &str) {
    {
      let mut watched = self.inner.watched.lock_or_recover();
      watched.insert(repo_path.to_string());
    }
    self.ensure_started();
    self.request_wake();
  }

  fn request_wake(&self) {
    self.inner.wake.1.notify_one();
  }
}

fn kickoff_background_loop(inner: Arc<LinearAutoKickoffInner>) {
  use std::time::Instant;
  let mut last_poll: Option<Instant> = None;

  loop {
    if inner.shutdown.load(Ordering::SeqCst) {
      break;
    }

    let now = Instant::now();
    let poll_due = last_poll
      .map(|t| now.duration_since(t) >= KICKOFF_POLL_INTERVAL)
      .unwrap_or(true);

    if poll_due {
      let repos: Vec<String> = inner.watched.lock_or_recover().iter().cloned().collect();
      for repo_path in repos {
        if inner.shutdown.load(Ordering::SeqCst) {
          break;
        }
        if let Err(e) = poll_linear_kickoff(&repo_path) {
          log::warn!("linear-kickoff: failed for {repo_path}: {e}");
        }
      }
      last_poll = Some(Instant::now());
    }

    if inner.shutdown.load(Ordering::SeqCst) {
      break;
    }

    let wait = last_poll
      .map(|t| {
        let elapsed = now.duration_since(t);
        KICKOFF_POLL_INTERVAL.saturating_sub(elapsed)
      })
      .unwrap_or(Duration::ZERO)
      .max(Duration::from_millis(5));

    let (lock, cvar) = &inner.wake;
    let guard = lock.lock_or_recover();
    let _ = cvar
      .wait_timeout_while(guard, wait, |_| !inner.shutdown.load(Ordering::SeqCst))
      .unwrap();
  }
}

fn poll_linear_kickoff(repo_path: &str) -> Result<(), String> {
  let db_path =
    std::env::var("TREQ_APP_DB_PATH").map_err(|_| "TREQ_APP_DB_PATH not set".to_string())?;
  let db = crate::db::Database::new(std::path::PathBuf::from(db_path))
    .map_err(|e| format!("Failed to open database: {e}"))?;

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

  let mut ledger = KickoffLedger::load(&db, repo_path)?;
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
  ledger.save(&db, repo_path)
}

const MAX_KICKOFF_ATTEMPTS: u32 = 3;

/// Per-repo record of which labeled issues were kicked off and which keep
/// failing. Failures retry on later polls up to `MAX_KICKOFF_ATTEMPTS`.
/// Removing and re-adding the label resets an issue.
#[derive(Default)]
struct KickoffLedger {
  handled: std::collections::HashSet<String>,
  failures: HashMap<String, u32>,
}

impl KickoffLedger {
  const HANDLED_KEY: &'static str = "linear_handled_issue_ids";
  const FAILURES_KEY: &'static str = "linear_kickoff_failures";

  fn load(db: &crate::db::Database, repo_path: &str) -> Result<Self, String> {
    let read = |key: &str| {
      db.get_repo_setting(repo_path, key)
        .map_err(|e| format!("Failed to read {key}: {e}"))
    };
    Ok(Self {
      handled: read(Self::HANDLED_KEY)?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default(),
      failures: read(Self::FAILURES_KEY)?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default(),
    })
  }

  fn save(&self, db: &crate::db::Database, repo_path: &str) -> Result<(), String> {
    let write = |key: &str, json: Result<String, serde_json::Error>| {
      let json = json.map_err(|e| format!("Failed to serialize {key}: {e}"))?;
      db.set_repo_setting(repo_path, key, &json)
        .map_err(|e| format!("Failed to save {key}: {e}"))
    };
    write(Self::HANDLED_KEY, serde_json::to_string(&self.handled))?;
    write(Self::FAILURES_KEY, serde_json::to_string(&self.failures))
  }

  /// Returns the labeled issues still owed an attempt. Entries for issues no
  /// longer labeled are dropped, which keeps the stored sets bounded.
  fn due(&mut self, labeled_ids: &[String]) -> Vec<String> {
    let labeled: std::collections::HashSet<&str> = labeled_ids.iter().map(String::as_str).collect();
    self.handled.retain(|id| labeled.contains(id.as_str()));
    self.failures.retain(|id, _| labeled.contains(id.as_str()));
    labeled_ids
      .iter()
      .filter(|id| {
        !self.handled.contains(*id)
          && self.failures.get(*id).copied().unwrap_or(0) < MAX_KICKOFF_ATTEMPTS
      })
      .cloned()
      .collect()
  }

  fn record_success(&mut self, issue_id: &str) {
    self.failures.remove(issue_id);
    self.handled.insert(issue_id.to_string());
  }

  fn record_failure(&mut self, issue_id: &str) -> u32 {
    let attempts = self.failures.entry(issue_id.to_string()).or_insert(0);
    *attempts += 1;
    *attempts
  }
}

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

static GLOBAL_KICKOFF_POLLER: std::sync::OnceLock<LinearAutoKickoffPoller> =
  std::sync::OnceLock::new();

pub fn kickoff_poller() -> &'static LinearAutoKickoffPoller {
  GLOBAL_KICKOFF_POLLER.get_or_init(LinearAutoKickoffPoller::new)
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
    let body = list_issues_body(Some(HOSTILE));
    assert!(!body["query"].as_str().unwrap().contains(HOSTILE));
    assert_eq!(body["variables"]["team"], HOSTILE);
  }

  #[test]
  fn list_issues_body_omits_team_filter_when_unset() {
    let body = list_issues_body(None);
    assert!(!body["query"].as_str().unwrap().contains("$team"));
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

  fn ids(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
  }

  #[test]
  fn kickoff_ledger_skips_handled_issues() {
    let mut ledger = KickoffLedger::default();
    ledger.record_success("a");
    assert_eq!(ledger.due(&ids(&["a", "b"])), ids(&["b"]));
  }

  #[test]
  fn kickoff_ledger_retries_failures_until_attempt_cap() {
    let mut ledger = KickoffLedger::default();
    for _ in 1..MAX_KICKOFF_ATTEMPTS {
      ledger.record_failure("a");
      assert_eq!(ledger.due(&ids(&["a"])), ids(&["a"]));
    }
    ledger.record_failure("a");
    assert!(ledger.due(&ids(&["a"])).is_empty());
  }

  #[test]
  fn kickoff_ledger_success_clears_failure_count() {
    let mut ledger = KickoffLedger::default();
    ledger.record_failure("a");
    ledger.record_success("a");
    assert!(!ledger.failures.contains_key("a"));
  }

  #[test]
  fn kickoff_ledger_forgets_issues_that_lost_the_label() {
    let mut ledger = KickoffLedger::default();
    ledger.record_success("a");
    for _ in 0..MAX_KICKOFF_ATTEMPTS {
      ledger.record_failure("b");
    }
    assert!(ledger.due(&ids(&["c"])) == ids(&["c"]));
    assert!(ledger.handled.is_empty());
    assert!(ledger.failures.is_empty());
  }
}
