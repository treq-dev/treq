//! Jira Cloud REST (v3) client for the issue-tracker integration.
//!
//! Auth is HTTP basic with the account email and an Atlassian API token, per
//! repo. Projects map to `TrackerContainer`, issues to `TrackerItem`. The
//! issue key doubles as the item id because every endpoint accepts it.

use crate::tracker::{
  TrackerContainer, TrackerItem, TrackerProvider, TrackerStatus, TrackerStatusCategory, TrackerUser,
};
use serde::Deserialize;
use serde_json::{json, Value};

const PROVIDER: TrackerProvider = TrackerProvider::Jira;
const MAX_RESULTS: u32 = 100;
/// Used when the repo has no `jira_jql` setting. The enhanced search endpoint
/// rejects unbounded queries, so the default always carries a restriction.
pub const DEFAULT_JQL: &str =
  "(assignee = currentUser() OR reporter = currentUser()) AND statusCategory != Done ORDER BY updated DESC";
const ISSUE_FIELDS: &[&str] = &[
  "summary",
  "description",
  "status",
  "labels",
  "assignee",
  "project",
  "parent",
  "subtasks",
];

#[derive(Clone, Debug)]
pub struct JiraConfig {
  pub base_url: String,
  pub email: String,
  pub api_token: String,
  pub jql: String,
}

pub fn resolve_config(repo_path: &str, db: &crate::db::Database) -> Result<JiraConfig, String> {
  let read =
    |suffix: &str| crate::tracker::read_setting(db, repo_path, &PROVIDER.setting_key(suffix));
  match (read("base_url")?, read("email")?, read("api_token")?) {
    (Some(base_url), Some(email), Some(api_token)) => Ok(JiraConfig {
      base_url: normalize_base_url(&base_url),
      email,
      api_token,
      jql: read("jql")?.unwrap_or_else(|| DEFAULT_JQL.to_string()),
    }),
    _ => Err(
      "Jira is not configured. Add the site URL, email, and API token in Settings > Integrations."
        .to_string(),
    ),
  }
}

/// Accepts `acme`, `acme.atlassian.net`, or a full URL and returns
/// `https://acme.atlassian.net` with no trailing slash.
pub(crate) fn normalize_base_url(raw: &str) -> String {
  let trimmed = raw.trim().trim_end_matches('/');
  let with_scheme = if trimmed.contains("://") {
    trimmed.to_string()
  } else if trimmed.contains('.') {
    format!("https://{trimmed}")
  } else {
    format!("https://{trimmed}.atlassian.net")
  };
  with_scheme.trim_end_matches('/').to_string()
}

/// Quotes a value for use as a JQL string literal.
fn jql_string(value: &str) -> String {
  format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Splits `ORDER BY ...` off the end of a JQL query.
fn split_order_by(jql: &str) -> (&str, &str) {
  match jql.to_ascii_lowercase().rfind("order by") {
    Some(idx) => (jql[..idx].trim(), jql[idx..].trim()),
    None => (jql.trim(), ""),
  }
}

/// Adds `extra` as an AND clause to `base`, keeping its ORDER BY at the end.
pub(crate) fn and_jql(base: &str, extra: &str) -> String {
  let (filter, order) = split_order_by(base);
  let combined = if filter.is_empty() {
    extra.to_string()
  } else {
    format!("{extra} AND ({filter})")
  };
  if order.is_empty() {
    combined
  } else {
    format!("{combined} {order}")
  }
}

/// `project` may be a project id or key; JQL's `project =` accepts both.
pub(crate) fn list_issues_jql(base: &str, project: Option<&str>) -> String {
  match project {
    Some(project) => and_jql(base, &format!("project = {}", jql_string(project))),
    None => base.trim().to_string(),
  }
}

pub(crate) fn labeled_issues_jql(label: &str) -> String {
  format!(
    "labels = {} AND statusCategory != Done ORDER BY created ASC",
    jql_string(label)
  )
}

pub(crate) fn search_body(jql: &str) -> Value {
  json!({ "jql": jql, "fields": ISSUE_FIELDS, "maxResults": MAX_RESULTS })
}

fn request(cfg: &JiraConfig, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
  reqwest::Client::new()
    .request(method, format!("{}{path}", cfg.base_url))
    .basic_auth(&cfg.email, Some(&cfg.api_token))
    .header("Accept", "application/json")
}

async fn send<T: serde::de::DeserializeOwned>(
  builder: reqwest::RequestBuilder,
) -> Result<T, String> {
  let response = builder
    .send()
    .await
    .map_err(|e| format!("Jira request failed: {e}"))?;
  if !response.status().is_success() {
    return Err(crate::tracker::http_error(PROVIDER, response).await);
  }
  response
    .json::<T>()
    .await
    .map_err(|e| format!("Failed to parse Jira response: {e}"))
}

#[derive(Deserialize, Debug)]
pub(crate) struct SearchResponse {
  #[serde(default)]
  issues: Vec<IssueNode>,
}

#[derive(Deserialize, Debug)]
pub(crate) struct IssueNode {
  key: String,
  #[serde(default)]
  fields: IssueFields,
}

#[derive(Deserialize, Debug, Default)]
pub(crate) struct IssueFields {
  #[serde(default)]
  summary: String,
  #[serde(default)]
  description: Option<Value>,
  #[serde(default)]
  status: Option<StatusNode>,
  #[serde(default)]
  labels: Vec<String>,
  #[serde(default)]
  assignee: Option<UserNode>,
  #[serde(default)]
  project: Option<ProjectNode>,
  #[serde(default)]
  parent: Option<KeyRef>,
  #[serde(default)]
  subtasks: Vec<KeyRef>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct StatusNode {
  name: String,
  #[serde(default)]
  status_category: Option<StatusCategoryNode>,
}

#[derive(Deserialize, Debug)]
struct StatusCategoryNode {
  key: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct UserNode {
  account_id: String,
  #[serde(default)]
  display_name: Option<String>,
}

impl UserNode {
  fn into_user(self) -> TrackerUser {
    TrackerUser {
      name: self.display_name.unwrap_or_else(|| self.account_id.clone()),
      id: self.account_id,
    }
  }
}

#[derive(Deserialize, Debug)]
pub(crate) struct ProjectNode {
  id: String,
  key: String,
  name: String,
}

#[derive(Deserialize, Debug)]
struct KeyRef {
  key: String,
}

#[derive(Deserialize, Debug)]
struct ProjectSearchResponse {
  #[serde(default)]
  values: Vec<ProjectNode>,
}

/// Jira's status categories are `new`, `indeterminate`, and `done`.
fn status_category(key: Option<&str>) -> TrackerStatusCategory {
  match key {
    Some("done") => TrackerStatusCategory::Done,
    Some("indeterminate") => TrackerStatusCategory::InProgress,
    _ => TrackerStatusCategory::Todo,
  }
}

/// Flattens an Atlassian Document Format tree to plain text. Block nodes end
/// with a newline; list items get a `- ` prefix. Formatting marks are dropped.
pub(crate) fn adf_to_text(node: &Value) -> String {
  let mut out = String::new();
  write_adf(node, &mut out);
  let lines: Vec<&str> = out.lines().map(str::trim_end).collect();
  let mut text = lines.join("\n");
  while text.contains("\n\n\n") {
    text = text.replace("\n\n\n", "\n\n");
  }
  text.trim().to_string()
}

fn write_adf(node: &Value, out: &mut String) {
  let node_type = node.get("type").and_then(Value::as_str).unwrap_or("");
  match node_type {
    "text" => {
      if let Some(text) = node.get("text").and_then(Value::as_str) {
        out.push_str(text);
      }
      return;
    }
    "hardBreak" => {
      out.push('\n');
      return;
    }
    "mention" | "emoji" => {
      if let Some(text) = node.pointer("/attrs/text").and_then(Value::as_str) {
        out.push_str(text);
      }
      return;
    }
    "inlineCard" | "blockCard" => {
      if let Some(url) = node.pointer("/attrs/url").and_then(Value::as_str) {
        out.push_str(url);
      }
      if node_type == "blockCard" {
        out.push('\n');
      }
      return;
    }
    "listItem" => out.push_str("- "),
    "codeBlock" => out.push_str("```\n"),
    _ => {}
  }
  if let Some(children) = node.get("content").and_then(Value::as_array) {
    for child in children {
      write_adf(child, out);
    }
  }
  match node_type {
    "codeBlock" => out.push_str("\n```\n\n"),
    "paragraph" | "heading" | "blockquote" | "rule" | "panel" => out.push_str("\n\n"),
    "listItem" => {
      if !out.ends_with('\n') {
        out.push('\n');
      }
    }
    "bulletList" | "orderedList" => out.push('\n'),
    _ => {}
  }
}

fn description_text(description: Option<Value>) -> Option<String> {
  match description? {
    Value::String(s) => Some(s),
    Value::Null => None,
    doc => Some(adf_to_text(&doc)),
  }
  .filter(|s| !s.trim().is_empty())
}

pub(crate) fn map_issue(base_url: &str, issue: IssueNode) -> TrackerItem {
  let fields = issue.fields;
  let (status_name, category_key) = match fields.status {
    Some(s) => (s.name, s.status_category.map(|c| c.key)),
    None => (String::new(), None),
  };
  TrackerItem {
    url: format!("{base_url}/browse/{}", issue.key),
    branch_name: crate::tracker::branch_name(&issue.key, &fields.summary),
    id: issue.key.clone(),
    key: issue.key,
    title: fields.summary,
    description: description_text(fields.description),
    status: TrackerStatus {
      name: status_name,
      category: status_category(category_key.as_deref()),
    },
    labels: fields.labels,
    assignees: fields
      .assignee
      .map(UserNode::into_user)
      .into_iter()
      .collect(),
    container: fields.project.map(|p| TrackerContainer {
      id: p.id,
      name: p.name,
      key: Some(p.key),
    }),
    parent_id: fields.parent.map(|p| p.key),
    sub_item_ids: fields.subtasks.into_iter().map(|s| s.key).collect(),
  }
}

async fn search(cfg: &JiraConfig, jql: &str) -> Result<Vec<TrackerItem>, String> {
  let response: SearchResponse =
    send(request(cfg, reqwest::Method::POST, "/rest/api/3/search/jql").json(&search_body(jql)))
      .await?;
  Ok(
    response
      .issues
      .into_iter()
      .map(|issue| map_issue(&cfg.base_url, issue))
      .collect(),
  )
}

pub async fn list_projects(cfg: &JiraConfig) -> Result<Vec<TrackerContainer>, String> {
  let response: ProjectSearchResponse = send(
    request(cfg, reqwest::Method::GET, "/rest/api/3/project/search")
      .query(&[("maxResults", "100"), ("orderBy", "name")]),
  )
  .await?;
  Ok(
    response
      .values
      .into_iter()
      .map(|p| TrackerContainer {
        id: p.id,
        name: p.name,
        key: Some(p.key),
      })
      .collect(),
  )
}

/// Issues matching the repo's JQL, narrowed to `project` when given.
pub async fn list_issues(
  cfg: &JiraConfig,
  project: Option<&str>,
) -> Result<Vec<TrackerItem>, String> {
  search(cfg, &list_issues_jql(&cfg.jql, project)).await
}

pub async fn get_issue(cfg: &JiraConfig, key: &str) -> Result<TrackerItem, String> {
  let issue: IssueNode = send(
    request(
      cfg,
      reqwest::Method::GET,
      &format!("/rest/api/3/issue/{}", urlencoding::encode(key)),
    )
    .query(&[("fields", ISSUE_FIELDS.join(","))]),
  )
  .await?;
  Ok(map_issue(&cfg.base_url, issue))
}

pub async fn get_viewer(cfg: &JiraConfig) -> Result<TrackerUser, String> {
  let me: UserNode = send(request(cfg, reqwest::Method::GET, "/rest/api/3/myself")).await?;
  Ok(me.into_user())
}

pub async fn list_labeled_issue_keys(cfg: &JiraConfig, label: &str) -> Result<Vec<String>, String> {
  let items = search(cfg, &labeled_issues_jql(label)).await?;
  Ok(items.into_iter().map(|i| i.id).collect())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn normalize_base_url_accepts_site_name_host_or_url() {
    assert_eq!(normalize_base_url("acme"), "https://acme.atlassian.net");
    assert_eq!(
      normalize_base_url("acme.atlassian.net/"),
      "https://acme.atlassian.net"
    );
    assert_eq!(
      normalize_base_url(" https://jira.acme.io/ "),
      "https://jira.acme.io"
    );
  }

  #[test]
  fn list_issues_jql_scopes_project_and_keeps_order_by_last() {
    assert_eq!(
      list_issues_jql("statusCategory != Done ORDER BY updated DESC", Some("ENG")),
      "project = \"ENG\" AND (statusCategory != Done) ORDER BY updated DESC"
    );
    assert_eq!(list_issues_jql(" labels = x ", None), "labels = x");
  }

  #[test]
  fn and_jql_handles_order_by_only_base() {
    assert_eq!(
      and_jql("order by created", "project = \"A\""),
      "project = \"A\" order by created"
    );
  }

  #[test]
  fn jql_values_are_quoted_and_escaped() {
    assert_eq!(
      labeled_issues_jql("say \"hi\""),
      "labels = \"say \\\"hi\\\"\" AND statusCategory != Done ORDER BY created ASC"
    );
    assert_eq!(
      list_issues_jql("a = b", Some("X\" OR 1=1")),
      "project = \"X\\\" OR 1=1\" AND (a = b)"
    );
  }

  #[test]
  fn search_body_requests_issue_fields() {
    let body = search_body("project = A");
    assert_eq!(body["jql"], "project = A");
    assert_eq!(body["maxResults"], MAX_RESULTS);
    assert!(body["fields"]
      .as_array()
      .unwrap()
      .contains(&json!("subtasks")));
  }

  #[test]
  fn adf_to_text_flattens_paragraphs_lists_and_code() {
    let doc = json!({
      "type": "doc",
      "content": [
        {"type": "paragraph", "content": [
          {"type": "text", "text": "Hello "},
          {"type": "text", "text": "world", "marks": [{"type": "strong"}]},
          {"type": "mention", "attrs": {"text": "@ada"}}
        ]},
        {"type": "bulletList", "content": [
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "one"}]}]},
          {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "two"}]}]}
        ]},
        {"type": "codeBlock", "content": [{"type": "text", "text": "cargo test"}]}
      ]
    });
    assert_eq!(
      adf_to_text(&doc),
      "Hello world@ada\n\n- one\n\n- two\n\n```\ncargo test\n```"
    );
  }

  #[test]
  fn maps_search_response_to_tracker_items() {
    let json = r#"{
      "issues": [{
        "id": "10001",
        "key": "ENG-42",
        "fields": {
          "summary": "Add Jira integration",
          "description": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Mirror Linear."}]}
          ]},
          "status": {"name": "In Progress", "statusCategory": {"key": "indeterminate"}},
          "labels": ["agent"],
          "assignee": {"accountId": "acc-1", "displayName": "Ada"},
          "project": {"id": "100", "key": "ENG", "name": "Engineering"},
          "parent": {"key": "ENG-1"},
          "subtasks": [{"key": "ENG-43"}, {"key": "ENG-44"}]
        }
      }, {
        "key": "ENG-50",
        "fields": {"summary": "Bare", "description": null}
      }],
      "isLast": true
    }"#;
    let response: SearchResponse = serde_json::from_str(json).unwrap();
    let items: Vec<TrackerItem> = response
      .issues
      .into_iter()
      .map(|i| map_issue("https://acme.atlassian.net", i))
      .collect();

    let issue = &items[0];
    assert_eq!(issue.id, "ENG-42");
    assert_eq!(issue.key, "ENG-42");
    assert_eq!(issue.url, "https://acme.atlassian.net/browse/ENG-42");
    assert_eq!(issue.branch_name, "ENG-42-add-jira-integration");
    assert_eq!(issue.description.as_deref(), Some("Mirror Linear."));
    assert_eq!(issue.status.name, "In Progress");
    assert_eq!(issue.status.category, TrackerStatusCategory::InProgress);
    assert_eq!(issue.labels, vec!["agent"]);
    assert_eq!(issue.assignees[0].id, "acc-1");
    assert_eq!(
      issue.container.as_ref().unwrap().key.as_deref(),
      Some("ENG")
    );
    assert_eq!(issue.parent_id.as_deref(), Some("ENG-1"));
    assert_eq!(issue.sub_item_ids, vec!["ENG-43", "ENG-44"]);

    assert_eq!(items[1].description, None);
    assert_eq!(items[1].status.category, TrackerStatusCategory::Todo);
    assert!(items[1].assignees.is_empty());
  }

  #[test]
  fn resolve_config_defaults_jql_and_normalizes_url() {
    let dir = tempfile::TempDir::new().unwrap();
    let db = crate::db::Database::new(dir.path().join("treq.db")).unwrap();
    db.init().unwrap();
    assert!(resolve_config("/repo", &db).is_err());
    db.set_repo_setting("/repo", "jira_base_url", "acme")
      .unwrap();
    db.set_repo_setting("/repo", "jira_email", "a@acme.io")
      .unwrap();
    db.set_repo_setting("/repo", "jira_api_token", "tok")
      .unwrap();
    let cfg = resolve_config("/repo", &db).unwrap();
    assert_eq!(cfg.base_url, "https://acme.atlassian.net");
    assert_eq!(cfg.jql, DEFAULT_JQL);
  }
}
