use tauri_plugin_cli::Matches;

use crate::core;
use crate::local_db;

use super::{
  classify_cli_error, detect_repo_path, get_arg_value, print_json, print_json_error, OutputFormat,
};

/// Comment rows written by `treq agent review` always carry this source, so a
/// later local producer can be told apart from the review agent's output.
const LOCAL_AGENT_SOURCE: &str = "local-agent";

/// Default target type when the caller does not pass `--target-type`.
const DEFAULT_TARGET_TYPE: &str = "workspace_diff";

fn require_value(matches: &Matches, name: &str) -> Result<String, String> {
  get_arg_value(matches, name).ok_or_else(|| format!("--{name} is required"))
}

fn parse_line_number(value: &str, name: &str) -> Result<i64, String> {
  value
    .trim()
    .parse::<i64>()
    .map_err(|_| format!("--{name} must be a positive line number, got '{value}'"))
}

fn parse_side(value: Option<&str>) -> Result<Option<String>, String> {
  match value.map(str::trim) {
    None | Some("") => Ok(None),
    Some("old") => Ok(Some("old".to_string())),
    Some("new") => Ok(Some("new".to_string())),
    Some(other) => Err(format!("invalid side '{other}'. Expected one of: old, new")),
  }
}

/// Strip a GitHub-style ```suggestion fence, so the stored replacement is the
/// raw text the apply command splices into the file. Text without a fence is
/// returned unchanged.
pub(super) fn strip_suggestion_fence(text: &str) -> String {
  let trimmed = text.trim();
  let Some(rest) = trimmed.strip_prefix("```suggestion") else {
    return text.to_string();
  };
  let body = rest.strip_prefix('\n').unwrap_or(rest).trim_end();
  let body = body.strip_suffix("```").unwrap_or(body);
  body.trim_end_matches('\n').to_string()
}

/// `treq agent-review <action>` — writes local-only review comments straight to
/// the repo's local DB. No running GUI instance is needed: nothing here touches
/// a live session, it only records what the review agent found.
pub(super) fn handle_agent_review_command(matches: &Matches) -> Result<(), String> {
  let format = OutputFormat::parse(get_arg_value(matches, "format").as_deref())?;
  match run_agent_review_action(matches, format) {
    Ok(()) => Ok(()),
    Err(error) => {
      if format == OutputFormat::Json {
        print_json_error(classify_cli_error(&error), &error);
      } else {
        eprintln!("Error: {error}");
      }
      Err(error)
    }
  }
}

fn run_agent_review_action(matches: &Matches, format: OutputFormat) -> Result<(), String> {
  let action = get_arg_value(matches, "action")
    .ok_or_else(|| "agent review action is required".to_string())?;
  let repo_path = detect_repo_path()?;
  core::init(&repo_path).map_err(|e| format!("Failed to initialize repo: {e}"))?;

  match action.as_str() {
    "add" => {
      let start_line = parse_line_number(&require_value(matches, "start-line")?, "start-line")?;
      let end_line = match get_arg_value(matches, "end-line") {
        Some(value) => parse_line_number(&value, "end-line")?,
        None => start_line,
      };
      if start_line < 1 || end_line < start_line {
        return Err(format!(
          "invalid line range {start_line}..{end_line}: expected 1 <= start-line <= end-line"
        ));
      }
      let suggestion = get_arg_value(matches, "suggestion").map(|s| strip_suggestion_fence(&s));
      let comment = local_db::create_agent_review_comment(
        &repo_path,
        &get_arg_value(matches, "target-type").unwrap_or_else(|| DEFAULT_TARGET_TYPE.to_string()),
        &require_value(matches, "target-id")?,
        &require_value(matches, "file")?,
        None,
        start_line,
        end_line,
        parse_side(get_arg_value(matches, "side").as_deref())?.as_deref(),
        &require_value(matches, "comment")?,
        suggestion.as_deref(),
        LOCAL_AGENT_SOURCE,
      )?;
      match format {
        OutputFormat::Json => print_json(&comment),
        OutputFormat::Human => {
          println!(
            "Added review comment {} on {}:{}-{}",
            comment.id, comment.file_path, comment.start_line, comment.end_line
          );
          Ok(())
        }
      }
    }
    "list" => {
      let comments = local_db::list_agent_review_comments(
        &repo_path,
        &get_arg_value(matches, "target-type").unwrap_or_else(|| DEFAULT_TARGET_TYPE.to_string()),
        &require_value(matches, "target-id")?,
      )?;
      match format {
        OutputFormat::Json => print_json(&comments),
        OutputFormat::Human => {
          if comments.is_empty() {
            println!("No review comments");
          }
          for comment in &comments {
            println!(
              "{} [{}] {}:{}-{} {}",
              comment.id,
              comment.status,
              comment.file_path,
              comment.start_line,
              comment.end_line,
              comment.comment_text
            );
          }
          Ok(())
        }
      }
    }
    "resolve" => {
      let comment_id = require_value(matches, "comment-id")?;
      local_db::resolve_agent_review_comment(&repo_path, &comment_id)?;
      match format {
        OutputFormat::Json => print_json(&serde_json::json!({ "resolved": comment_id })),
        OutputFormat::Human => {
          println!("Resolved review comment {comment_id}");
          Ok(())
        }
      }
    }
    "delete" => {
      let comment_id = require_value(matches, "comment-id")?;
      local_db::delete_agent_review_comment(&repo_path, &comment_id)?;
      match format {
        OutputFormat::Json => print_json(&serde_json::json!({ "deleted": comment_id })),
        OutputFormat::Human => {
          println!("Deleted review comment {comment_id}");
          Ok(())
        }
      }
    }
    other => Err(format!("unknown agent review action '{other}'")),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn strips_a_suggestion_fence() {
    assert_eq!(
      strip_suggestion_fence("```suggestion\nlet x = 1;\nlet y = 2;\n```"),
      "let x = 1;\nlet y = 2;"
    );
  }

  #[test]
  fn leaves_unfenced_text_alone() {
    assert_eq!(strip_suggestion_fence("let x = 1;"), "let x = 1;");
  }

  #[test]
  fn keeps_an_empty_suggestion_empty() {
    assert_eq!(strip_suggestion_fence("```suggestion\n```"), "");
  }

  #[test]
  fn rejects_an_unknown_side() {
    assert!(parse_side(Some("both")).is_err());
    assert_eq!(parse_side(Some("old")).unwrap().as_deref(), Some("old"));
    assert_eq!(parse_side(None).unwrap(), None);
  }
}
