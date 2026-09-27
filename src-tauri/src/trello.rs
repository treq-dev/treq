//! Trello REST client for the issue-tracker integration.
//!
//! Auth uses a per-repo API key and user token, sent in the `Authorization`
//! header rather than the query string so they stay out of request logs.
//! Boards map to `TrackerContainer`, cards to `TrackerItem`, and the card's
//! list becomes its status.

use crate::tracker::{
  TrackerContainer, TrackerItem, TrackerProvider, TrackerStatus, TrackerStatusCategory, TrackerUser,
};
use serde::Deserialize;
use std::collections::HashMap;

const API_BASE: &str = "https://api.trello.com/1";
const PROVIDER: TrackerProvider = TrackerProvider::Trello;
/// Upper bound on boards scanned per auto-kickoff poll.
const MAX_POLLED_BOARDS: usize = 25;
const CARD_FIELDS: &str = "name,desc,idShort,shortLink,url,idList,labels,idMembers,closed";

#[derive(Clone, Debug)]
pub struct TrelloConfig {
  pub api_key: String,
  pub token: String,
}

pub fn resolve_config(repo_path: &str, db: &crate::db::Database) -> Result<TrelloConfig, String> {
  let read =
    |suffix: &str| crate::tracker::read_setting(db, repo_path, &PROVIDER.setting_key(suffix));
  match (read("api_key")?, read("token")?) {
    (Some(api_key), Some(token)) => Ok(TrelloConfig { api_key, token }),
    _ => Err(
      "Trello is not configured. Add an API key and token in Settings > Integrations.".to_string(),
    ),
  }
}

fn auth_header(cfg: &TrelloConfig) -> String {
  format!(
    "OAuth oauth_consumer_key=\"{}\", oauth_token=\"{}\"",
    cfg.api_key, cfg.token
  )
}

async fn get<T: serde::de::DeserializeOwned>(
  cfg: &TrelloConfig,
  path: &str,
  query: &[(&str, &str)],
) -> Result<T, String> {
  let response = reqwest::Client::new()
    .get(format!("{API_BASE}{path}"))
    .header("Authorization", auth_header(cfg))
    .header("Accept", "application/json")
    .query(query)
    .send()
    .await
    .map_err(|e| format!("Trello request failed: {e}"))?;
  if !response.status().is_success() {
    return Err(crate::tracker::http_error(PROVIDER, response).await);
  }
  response
    .json::<T>()
    .await
    .map_err(|e| format!("Failed to parse Trello response: {e}"))
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BoardNode {
  id: String,
  name: String,
  #[serde(default)]
  lists: Vec<ListNode>,
  #[serde(default)]
  cards: Vec<CardNode>,
  #[serde(default)]
  members: Vec<MemberNode>,
}

#[derive(Deserialize, Debug)]
pub(crate) struct ListNode {
  id: String,
  name: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemberNode {
  id: String,
  #[serde(default)]
  full_name: Option<String>,
  #[serde(default)]
  username: Option<String>,
}

impl MemberNode {
  fn into_user(self) -> TrackerUser {
    let name = self
      .full_name
      .filter(|n| !n.is_empty())
      .or(self.username)
      .unwrap_or_else(|| self.id.clone());
    TrackerUser { id: self.id, name }
  }
}

#[derive(Deserialize, Debug)]
pub(crate) struct LabelNode {
  #[serde(default)]
  name: String,
  #[serde(default)]
  color: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CardNode {
  id: String,
  name: String,
  #[serde(default)]
  desc: String,
  id_short: i64,
  short_link: String,
  url: String,
  id_list: String,
  #[serde(default)]
  labels: Vec<LabelNode>,
  #[serde(default)]
  id_members: Vec<String>,
  #[serde(default)]
  closed: bool,
  // Present on single-card fetches with `list=true`, `board=true`, `members=true`.
  #[serde(default)]
  list: Option<ListNode>,
  #[serde(default)]
  board: Option<ListNode>,
  #[serde(default)]
  members: Option<Vec<MemberNode>>,
}

/// Maps a Trello list name onto a workflow bucket. Trello has no status
/// model, so this reads the conventional column names.
pub(crate) fn status_category(list_name: &str, closed: bool) -> TrackerStatusCategory {
  if closed {
    return TrackerStatusCategory::Done;
  }
  let name = list_name.to_ascii_lowercase();
  let has = |words: &[&str]| words.iter().any(|w| name.contains(w));
  if has(&[
    "done", "complete", "shipped", "released", "closed", "merged",
  ]) {
    TrackerStatusCategory::Done
  } else if has(&[
    "doing", "progress", "review", "active", "wip", "testing", "qa",
  ]) {
    TrackerStatusCategory::InProgress
  } else {
    TrackerStatusCategory::Todo
  }
}

/// Label names, falling back to the color for Trello's unnamed color labels.
fn label_names(labels: Vec<LabelNode>) -> Vec<String> {
  labels
    .into_iter()
    .filter_map(|l| {
      if !l.name.trim().is_empty() {
        Some(l.name)
      } else {
        l.color
      }
    })
    .collect()
}

fn map_card(
  card: CardNode,
  list_name: &str,
  board: Option<&TrackerContainer>,
  members: &HashMap<String, TrackerUser>,
) -> TrackerItem {
  let assignees = card
    .id_members
    .iter()
    .filter_map(|id| members.get(id).cloned())
    .collect();
  let description = Some(card.desc).filter(|d| !d.trim().is_empty());
  TrackerItem {
    key: format!("#{}", card.id_short),
    branch_name: crate::tracker::branch_name(&format!("trello-{}", card.short_link), &card.name),
    title: card.name,
    description,
    url: card.url,
    status: TrackerStatus {
      name: list_name.to_string(),
      category: status_category(list_name, card.closed),
    },
    labels: label_names(card.labels),
    assignees,
    container: board.cloned(),
    parent_id: None,
    sub_item_ids: vec![],
    id: card.id,
  }
}

pub(crate) fn map_board(board: BoardNode) -> Vec<TrackerItem> {
  let container = TrackerContainer {
    id: board.id,
    name: board.name,
    key: None,
  };
  let lists: HashMap<String, String> = board.lists.into_iter().map(|l| (l.id, l.name)).collect();
  let members: HashMap<String, TrackerUser> = board
    .members
    .into_iter()
    .map(|m| (m.id.clone(), m.into_user()))
    .collect();
  board
    .cards
    .into_iter()
    .map(|card| {
      let list_name = lists.get(&card.id_list).cloned().unwrap_or_default();
      map_card(card, &list_name, Some(&container), &members)
    })
    .collect()
}

pub(crate) fn map_single_card(mut card: CardNode) -> TrackerItem {
  let list_name = card.list.take().map(|l| l.name).unwrap_or_default();
  let board = card.board.take().map(|b| TrackerContainer {
    id: b.id,
    name: b.name,
    key: None,
  });
  let members: HashMap<String, TrackerUser> = card
    .members
    .take()
    .unwrap_or_default()
    .into_iter()
    .map(|m| (m.id.clone(), m.into_user()))
    .collect();
  map_card(card, &list_name, board.as_ref(), &members)
}

pub async fn list_boards(cfg: &TrelloConfig) -> Result<Vec<TrackerContainer>, String> {
  let boards: Vec<ListNode> = get(
    cfg,
    "/members/me/boards",
    &[("filter", "open"), ("fields", "name")],
  )
  .await?;
  Ok(
    boards
      .into_iter()
      .map(|b| TrackerContainer {
        id: b.id,
        name: b.name,
        key: None,
      })
      .collect(),
  )
}

async fn fetch_board_cards(cfg: &TrelloConfig, board_id: &str) -> Result<Vec<TrackerItem>, String> {
  let board: BoardNode = get(
    cfg,
    &format!("/boards/{}", urlencoding::encode(board_id)),
    &[
      ("fields", "name"),
      ("lists", "open"),
      ("list_fields", "name"),
      ("cards", "open"),
      ("card_fields", CARD_FIELDS),
      ("members", "all"),
      ("member_fields", "fullName,username"),
    ],
  )
  .await?;
  Ok(map_board(board))
}

/// Cards on `board_id`, or on the first open board when none is given.
/// Trello has no cross-board card listing, so a board is always required.
pub async fn list_cards(
  cfg: &TrelloConfig,
  board_id: Option<&str>,
) -> Result<Vec<TrackerItem>, String> {
  let board_id = match board_id {
    Some(id) => id.to_string(),
    None => match list_boards(cfg).await?.into_iter().next() {
      Some(board) => board.id,
      None => return Ok(vec![]),
    },
  };
  fetch_board_cards(cfg, &board_id).await
}

pub async fn get_card(cfg: &TrelloConfig, card_id: &str) -> Result<TrackerItem, String> {
  let card: CardNode = get(
    cfg,
    &format!("/cards/{}", urlencoding::encode(card_id)),
    &[
      ("fields", CARD_FIELDS),
      ("list", "true"),
      ("list_fields", "name"),
      ("board", "true"),
      ("board_fields", "name"),
      ("members", "true"),
      ("member_fields", "fullName,username"),
    ],
  )
  .await?;
  Ok(map_single_card(card))
}

pub async fn get_viewer(cfg: &TrelloConfig) -> Result<TrackerUser, String> {
  let me: MemberNode = get(cfg, "/members/me", &[("fields", "fullName,username")]).await?;
  Ok(me.into_user())
}

pub async fn list_labeled_card_ids(cfg: &TrelloConfig, label: &str) -> Result<Vec<String>, String> {
  let mut ids = vec![];
  for board in list_boards(cfg).await?.into_iter().take(MAX_POLLED_BOARDS) {
    let cards = fetch_board_cards(cfg, &board.id).await?;
    ids.extend(
      cards
        .into_iter()
        .filter(|c| c.status.category != TrackerStatusCategory::Done)
        .filter(|c| c.labels.iter().any(|l| l.eq_ignore_ascii_case(label)))
        .map(|c| c.id),
    );
  }
  Ok(ids)
}

#[cfg(test)]
mod tests {
  use super::*;

  const BOARD_JSON: &str = r#"{
    "id": "board-1",
    "name": "Roadmap",
    "lists": [
      {"id": "list-todo", "name": "To Do"},
      {"id": "list-doing", "name": "Doing"}
    ],
    "members": [
      {"id": "mem-1", "fullName": "Ada Lovelace", "username": "ada"},
      {"id": "mem-2", "fullName": "", "username": "bob"}
    ],
    "cards": [
      {
        "id": "card-1",
        "name": "Add Trello integration!",
        "desc": "Kick off workspaces from cards",
        "idShort": 12,
        "shortLink": "AbC123xy",
        "url": "https://trello.com/c/AbC123xy/12-add-trello-integration",
        "idList": "list-doing",
        "idBoard": "board-1",
        "labels": [{"name": "agent", "color": "green"}, {"name": "", "color": "red"}],
        "idMembers": ["mem-1", "mem-2", "mem-unknown"],
        "closed": false
      },
      {
        "id": "card-2",
        "name": "Empty desc",
        "desc": "  ",
        "idShort": 13,
        "shortLink": "Zz9",
        "url": "https://trello.com/c/Zz9",
        "idList": "list-gone"
      }
    ]
  }"#;

  #[test]
  fn maps_board_cards_to_tracker_items() {
    let board: BoardNode = serde_json::from_str(BOARD_JSON).unwrap();
    let items = map_board(board);
    assert_eq!(items.len(), 2);

    let card = &items[0];
    assert_eq!(card.id, "card-1");
    assert_eq!(card.key, "#12");
    assert_eq!(card.title, "Add Trello integration!");
    assert_eq!(
      card.description.as_deref(),
      Some("Kick off workspaces from cards")
    );
    assert_eq!(card.branch_name, "trello-AbC123xy-add-trello-integration");
    assert_eq!(card.status.name, "Doing");
    assert_eq!(card.status.category, TrackerStatusCategory::InProgress);
    assert_eq!(card.labels, vec!["agent", "red"]);
    let names: Vec<&str> = card.assignees.iter().map(|a| a.name.as_str()).collect();
    assert_eq!(names, vec!["Ada Lovelace", "bob"]);
    assert_eq!(card.container.as_ref().unwrap().name, "Roadmap");

    assert_eq!(items[1].description, None);
    assert_eq!(items[1].status.name, "");
    assert_eq!(items[1].status.category, TrackerStatusCategory::Todo);
  }

  #[test]
  fn maps_single_card_with_nested_list_board_and_members() {
    let json = r#"{
      "id": "card-9", "name": "Ship it", "desc": "", "idShort": 9,
      "shortLink": "Q1w2", "url": "https://trello.com/c/Q1w2", "idList": "l",
      "labels": [], "idMembers": ["m"], "closed": false,
      "list": {"id": "l", "name": "Done"},
      "board": {"id": "b", "name": "Ops"},
      "members": [{"id": "m", "fullName": "Grace"}]
    }"#;
    let card: CardNode = serde_json::from_str(json).unwrap();
    let item = map_single_card(card);
    assert_eq!(item.status.category, TrackerStatusCategory::Done);
    assert_eq!(item.container.unwrap().id, "b");
    assert_eq!(item.assignees[0].name, "Grace");
  }

  #[test]
  fn status_category_reads_common_list_names() {
    assert_eq!(
      status_category("Backlog", false),
      TrackerStatusCategory::Todo
    );
    assert_eq!(
      status_category("In Progress", false),
      TrackerStatusCategory::InProgress
    );
    assert_eq!(
      status_category("Code Review", false),
      TrackerStatusCategory::InProgress
    );
    assert_eq!(
      status_category("Done ✅", false),
      TrackerStatusCategory::Done
    );
    assert_eq!(status_category("To Do", true), TrackerStatusCategory::Done);
  }

  #[test]
  fn resolve_config_requires_key_and_token() {
    let dir = tempfile::TempDir::new().unwrap();
    let db = crate::db::Database::new(dir.path().join("treq.db")).unwrap();
    db.init().unwrap();
    assert!(resolve_config("/repo", &db).is_err());
    db.set_repo_setting("/repo", "trello_api_key", "k").unwrap();
    assert!(resolve_config("/repo", &db).is_err());
    db.set_repo_setting("/repo", "trello_token", " t ").unwrap();
    let cfg = resolve_config("/repo", &db).unwrap();
    assert_eq!(cfg.api_key, "k");
    assert_eq!(cfg.token, "t");
  }
}
