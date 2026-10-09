//! `treq notify` messages sent from the CLI to the running app, and the rule
//! that decides whether the app turns one into an OS notification.

use serde::{Deserialize, Serialize};

pub const NOTIFY_KIND: &str = "notify";

/// App setting behind "Notify when an agent finishes". Notifications stay on
/// unless it is `"false"`.
pub const NOTIFY_SETTING_KEY: &str = "notify_agent_finished";

pub const SKIP_FOCUSED: &str = "a Treq window is focused";
pub const SKIP_DISABLED: &str = "notifications are turned off in Settings";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotifyEvent {
  /// `treq notify "<message>"`: the agent asks for the user.
  Message,
  /// `treq notify --agent-exited`, sent by an agent session's launch command.
  AgentExited,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NotifyDispatchRequest {
  pub kind: String,
  pub request_id: String,
  pub repo: String,
  /// Workspace branch name. `None` when the command ran in the home repository.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub workspace: Option<String>,
  pub event: NotifyEvent,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentNotification {
  pub title: String,
  pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotifyDecision {
  Show(AgentNotification),
  Skip(&'static str),
}

pub const MAX_MESSAGE_CHARS: usize = 200;

pub fn notifications_enabled(setting: Option<&str>) -> bool {
  setting.map(str::trim) != Some("false")
}

/// The workspace branch name, or the repository directory name when the
/// command ran in the home repository.
fn workspace_label(request: &NotifyDispatchRequest) -> String {
  if let Some(workspace) = request.workspace.as_deref().map(str::trim) {
    if !workspace.is_empty() {
      return workspace.to_string();
    }
  }
  std::path::Path::new(&request.repo)
    .file_name()
    .map(|name| name.to_string_lossy().into_owned())
    .unwrap_or_else(|| request.repo.clone())
}

pub fn build_notification(request: &NotifyDispatchRequest) -> AgentNotification {
  let workspace = workspace_label(request);
  let body = match request.event {
    NotifyEvent::Message => request.message.clone().unwrap_or_default(),
    NotifyEvent::AgentExited => format!("Agent finished in {workspace}"),
  };
  AgentNotification {
    title: workspace,
    body,
  }
}

/// A notification only helps when the user is looking elsewhere, so a
/// focused Treq window suppresses it.
pub fn decide(
  request: &NotifyDispatchRequest,
  any_window_focused: bool,
  setting: Option<&str>,
) -> NotifyDecision {
  if !notifications_enabled(setting) {
    return NotifyDecision::Skip(SKIP_DISABLED);
  }
  if any_window_focused {
    return NotifyDecision::Skip(SKIP_FOCUSED);
  }
  NotifyDecision::Show(build_notification(request))
}

/// Flattens a message to one line of at most [`MAX_MESSAGE_CHARS`]
/// characters. `None` when nothing but whitespace is left.
pub fn normalize_message(raw: &str) -> Option<String> {
  let line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
  if line.is_empty() {
    return None;
  }
  if line.chars().count() <= MAX_MESSAGE_CHARS {
    return Some(line);
  }
  let mut truncated: String = line.chars().take(MAX_MESSAGE_CHARS - 1).collect();
  truncated.push('…');
  Some(truncated)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn request(
    workspace: Option<&str>,
    event: NotifyEvent,
    message: Option<&str>,
  ) -> NotifyDispatchRequest {
    NotifyDispatchRequest {
      kind: NOTIFY_KIND.to_string(),
      request_id: "notify-1".to_string(),
      repo: "/home/me/code/shop".to_string(),
      workspace: workspace.map(str::to_string),
      event,
      message: message.map(str::to_string),
    }
  }

  #[test]
  fn shows_message_titled_with_workspace_when_no_window_is_focused() {
    let req = request(
      Some("feat/login"),
      NotifyEvent::Message,
      Some("Ready for review"),
    );
    assert_eq!(
      decide(&req, false, None),
      NotifyDecision::Show(AgentNotification {
        title: "feat/login".to_string(),
        body: "Ready for review".to_string(),
      })
    );
  }

  #[test]
  fn skips_when_a_treq_window_is_focused() {
    let req = request(Some("feat/login"), NotifyEvent::Message, Some("Ready"));
    assert_eq!(decide(&req, true, None), NotifyDecision::Skip(SKIP_FOCUSED));
  }

  #[test]
  fn skips_when_setting_is_off() {
    let req = request(Some("feat/login"), NotifyEvent::AgentExited, None);
    assert_eq!(
      decide(&req, false, Some("false")),
      NotifyDecision::Skip(SKIP_DISABLED)
    );
  }

  #[test]
  fn setting_defaults_to_on() {
    assert!(notifications_enabled(None));
    assert!(notifications_enabled(Some("true")));
    assert!(notifications_enabled(Some("")));
    assert!(!notifications_enabled(Some("false")));
    assert!(!notifications_enabled(Some(" false ")));
  }

  #[test]
  fn formats_agent_exit_with_workspace_name() {
    let req = request(Some("feat/login"), NotifyEvent::AgentExited, None);
    assert_eq!(
      build_notification(&req),
      AgentNotification {
        title: "feat/login".to_string(),
        body: "Agent finished in feat/login".to_string(),
      }
    );
  }

  #[test]
  fn agent_exit_ignores_any_message() {
    let req = request(Some("feat/login"), NotifyEvent::AgentExited, Some("hi"));
    assert_eq!(
      build_notification(&req).body,
      "Agent finished in feat/login"
    );
  }

  #[test]
  fn uses_repo_directory_name_for_home_repository() {
    let req = request(None, NotifyEvent::AgentExited, None);
    assert_eq!(
      build_notification(&req),
      AgentNotification {
        title: "shop".to_string(),
        body: "Agent finished in shop".to_string(),
      }
    );
    let blank = request(Some("  "), NotifyEvent::Message, Some("Done"));
    assert_eq!(build_notification(&blank).title, "shop");
  }

  #[test]
  fn normalizes_message_to_one_trimmed_line() {
    assert_eq!(
      normalize_message("  Tests pass.\n\nReady   for review \n"),
      Some("Tests pass. Ready for review".to_string())
    );
    assert_eq!(normalize_message(" \n\t "), None);
  }

  #[test]
  fn truncates_long_messages_on_a_char_boundary() {
    let long = "é".repeat(MAX_MESSAGE_CHARS + 50);
    let normalized = normalize_message(&long).unwrap();
    assert_eq!(normalized.chars().count(), MAX_MESSAGE_CHARS);
    assert!(normalized.ends_with('…'));
  }

  #[test]
  fn round_trips_through_json_with_snake_case_event() {
    let req = request(Some("feat/login"), NotifyEvent::AgentExited, None);
    let json = serde_json::to_value(&req).unwrap();
    assert_eq!(json["kind"], "notify");
    assert_eq!(json["event"], "agent_exited");
    assert!(json.get("message").is_none());
    let back: NotifyDispatchRequest = serde_json::from_value(json).unwrap();
    assert_eq!(back, req);
  }
}
