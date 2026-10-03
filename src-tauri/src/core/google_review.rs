//! Reviewing Google Drive files with the review agent: export a file outside
//! any repo, then post the agent's findings back as Drive comments.

use std::path::PathBuf;

use serde::Serialize;

use crate::google::*;

/// Drive ids are `[A-Za-z0-9_-]`; anything else could escape the review dir.
pub fn valid_file_id(id: &str) -> bool {
  !id.is_empty()
    && id
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
thread_local! {
  static TEST_EXPORTS_DIR: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
}

/// Test-only: export into `dir` on this thread instead of ~/Documents.
#[cfg(test)]
pub fn use_test_exports_dir(dir: &std::path::Path) {
  TEST_EXPORTS_DIR.with(|d| *d.borrow_mut() = Some(dir.to_path_buf()));
}

/// `~/Documents/treq/exports`, or `$TREQ_EXPORTS_DIR` when set.
pub fn exports_root() -> Result<PathBuf, String> {
  #[cfg(test)]
  if let Some(dir) = TEST_EXPORTS_DIR.with(|d| d.borrow().clone()) {
    return Ok(dir);
  }
  if let Some(dir) = non_empty(std::env::var("TREQ_EXPORTS_DIR").ok()) {
    return Ok(PathBuf::from(dir));
  }
  let home = non_empty(std::env::var("HOME").ok())
    .or_else(|| non_empty(std::env::var("USERPROFILE").ok()))
    .ok_or("Cannot find the home directory to export documents into")?;
  Ok(PathBuf::from(home).join("Documents").join(EXPORTS_DIR))
}

/// Directory one Drive file is exported into for review.
pub fn review_root(file_id: &str) -> Result<PathBuf, String> {
  if !valid_file_id(file_id) {
    return Err(format!("Invalid Google Drive file id '{file_id}'"));
  }
  Ok(exports_root()?.join(file_id))
}

pub fn review_file_name(file: &DriveFile) -> String {
  // Exports get the export format's extension; downloads keep their own.
  let (base, ext) = match export_mime(&file.mime_type) {
    Some("text/markdown") => (file.name.as_str(), "md"),
    Some("text/csv") => (file.name.as_str(), "csv"),
    Some(_) => (file.name.as_str(), "txt"),
    None => file
      .name
      .rsplit_once('.')
      .unwrap_or((file.name.as_str(), "txt")),
  };
  let safe = |s: &str| -> String {
    s.chars()
      .map(|c| {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
          c
        } else {
          '-'
        }
      })
      .collect::<String>()
      .trim_matches('-')
      .chars()
      .take(60)
      .collect()
  };
  let stem = safe(base);
  let stem = if stem.is_empty() {
    "document".to_string()
  } else {
    stem
  };
  let ext = safe(ext);
  let ext = if ext.is_empty() {
    "txt".to_string()
  } else {
    ext
  };
  format!("{stem}.{ext}")
}

#[derive(Debug, Clone, Serialize)]
pub struct PreparedDocReview {
  pub file: DriveFile,
  /// Absolute directory the agent's `--file` is relative to.
  pub root: String,
  /// File name inside `root`.
  pub file_name: String,
  pub line_count: usize,
}

/// Exports the file into the review directory, replacing an earlier export.
pub async fn prepare_doc_review(
  source: &GoogleSource,
  repo_path: &str,
  file_id: &str,
) -> Result<PreparedDocReview, String> {
  let root = review_root(file_id)?;
  let file = get_drive_file(source, file_id).await?;
  let text = export_text(source, &file).await?;
  let file_name = review_file_name(&file);
  if root.exists() {
    std::fs::remove_dir_all(&root).map_err(|e| format!("Failed to clear review directory: {e}"))?;
  }
  std::fs::create_dir_all(&root).map_err(|e| format!("Failed to create review directory: {e}"))?;
  std::fs::write(root.join(&file_name), &text)
    .map_err(|e| format!("Failed to write exported document: {e}"))?;
  // Unposted comments point at lines of the export just replaced.
  discard_open_comments(repo_path, file_id)?;
  Ok(PreparedDocReview {
    line_count: text.lines().count(),
    root: root.to_string_lossy().into_owned(),
    file_name,
    file,
  })
}

/// The exported lines a comment covers, trimmed for use as a Drive quote.
pub fn quoted_lines(text: &str, start: i64, end: i64) -> Option<String> {
  let start = start.max(1) as usize;
  let end = (end.max(start as i64)) as usize;
  let quote = text
    .lines()
    .skip(start - 1)
    .take(end - start + 1)
    .collect::<Vec<_>>()
    .join("\n");
  let quote = quote.trim();
  if quote.is_empty() {
    None
  } else {
    Some(quote.chars().take(1000).collect())
  }
}

pub fn comment_content(comment: &crate::local_db::AgentReviewComment) -> String {
  let mut content = comment.comment_text.trim().to_string();
  if let Some(suggestion) = comment
    .suggested_replacement
    .as_deref()
    .filter(|s| !s.trim().is_empty())
  {
    content.push_str("\n\nSuggested:\n");
    content.push_str(suggestion.trim());
  }
  content.push_str("\n\n— treq review agent");
  content
}

fn discard_open_comments(repo_path: &str, file_id: &str) -> Result<(), String> {
  for comment in
    crate::local_db::list_agent_review_comments(repo_path, REVIEW_TARGET_TYPE, file_id)?
  {
    if comment.status == "open" {
      crate::local_db::delete_agent_review_comment(repo_path, &comment.id)?;
    }
  }
  Ok(())
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct PostCommentsResult {
  pub posted: usize,
  /// One message per comment that was not posted; those stay open.
  pub errors: Vec<String>,
}

/// Posts the open agent comments for `file_id` to Drive. Each comment is
/// resolved before it is sent and reopened if sending fails, so a retry
/// never posts the same comment twice. A failure does not stop the rest.
pub async fn post_review_comments(
  source: &GoogleSource,
  repo_path: &str,
  file_id: &str,
) -> Result<PostCommentsResult, String> {
  let root = review_root(file_id)?;
  let comments =
    crate::local_db::list_agent_review_comments(repo_path, REVIEW_TARGET_TYPE, file_id)?;
  let mut result = PostCommentsResult::default();
  for comment in comments.iter().filter(|c| c.status == "open") {
    crate::local_db::resolve_agent_review_comment(repo_path, &comment.id)?;
    let text = std::fs::read_to_string(root.join(&comment.file_path)).unwrap_or_default();
    let quote = quoted_lines(&text, comment.start_line, comment.end_line);
    match create_comment(source, file_id, &comment_content(comment), quote.as_deref()).await {
      Ok(_) => result.posted += 1,
      Err(e) => {
        crate::local_db::reopen_agent_review_comment(repo_path, &comment.id)?;
        result.errors.push(e);
      }
    }
  }
  Ok(result)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::google::tests::{local, mock};
  use serde_json::json;
  use wiremock::matchers::{body_partial_json, method, path};
  use wiremock::{Mock, ResponseTemplate};

  #[test]
  fn review_root_rejects_path_traversal() {
    use_test_exports_dir(std::path::Path::new("/docs/treq/exports"));
    assert!(review_root("../etc").is_err());
    assert!(review_root("").is_err());
    assert_eq!(
      review_root("abc_D-1").unwrap(),
      std::path::Path::new("/docs/treq/exports/abc_D-1")
    );
  }

  #[test]
  fn review_file_name_is_safe() {
    let doc =
      map_drive_file(&json!({"id": "1", "name": "Q3 plan / draft", "mimeType": GOOGLE_DOC_MIME}))
        .unwrap();
    assert!(doc.reviewable);
    assert_eq!(review_file_name(&doc), "Q3-plan---draft.md");
    let txt =
      map_drive_file(&json!({"id": "1", "name": "notes.txt", "mimeType": "text/plain"})).unwrap();
    assert_eq!(review_file_name(&txt), "notes.txt");
    let pdf =
      map_drive_file(&json!({"id": "1", "name": "a.pdf", "mimeType": "application/pdf"})).unwrap();
    assert!(!pdf.reviewable);
  }

  #[test]
  fn quoted_lines_covers_range() {
    let text = "one\ntwo\nthree\n";
    assert_eq!(quoted_lines(text, 2, 3).as_deref(), Some("two\nthree"));
    assert_eq!(quoted_lines(text, 3, 1).as_deref(), Some("three"));
    assert_eq!(quoted_lines(text, 9, 9), None);
  }

  fn add_comment(repo: &str, file_id: &str, text: &str) -> String {
    crate::local_db::create_agent_review_comment(
      repo,
      REVIEW_TARGET_TYPE,
      file_id,
      "doc.md",
      None,
      1,
      1,
      None,
      text,
      None,
      "local-agent",
    )
    .unwrap()
    .id
  }

  fn statuses(repo: &str, file_id: &str) -> Vec<(String, String)> {
    crate::local_db::list_agent_review_comments(repo, REVIEW_TARGET_TYPE, file_id)
      .unwrap()
      .into_iter()
      .map(|c| (c.comment_text, c.status))
      .collect()
  }

  #[tokio::test]
  async fn posting_continues_past_a_failure_and_reopens_it() {
    let server = mock().await;
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_str().unwrap();
    let exports = tempfile::tempdir().unwrap();
    use_test_exports_dir(exports.path());
    let root = review_root("doc1").unwrap();
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("doc.md"), "Line one\n").unwrap();
    add_comment(repo, "doc1", "bad");
    add_comment(repo, "doc1", "good");
    Mock::given(method("POST"))
      .and(path("/drive/v3/files/doc1/comments"))
      .and(body_partial_json(
        json!({"quotedFileContent": {"mimeType": "text/plain", "value": "Line one"}}),
      ))
      .and(wiremock::matchers::body_string_contains("bad"))
      .respond_with(ResponseTemplate::new(500).set_body_json(json!({"error": {"message": "boom"}})))
      .mount(&server)
      .await;
    Mock::given(method("POST"))
      .and(path("/drive/v3/files/doc1/comments"))
      .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "c"})))
      .mount(&server)
      .await;

    let result = post_review_comments(&local("tok"), repo, "doc1")
      .await
      .unwrap();
    assert_eq!(result.posted, 1);
    assert_eq!(result.errors, ["Google: boom"]);
    let mut states = statuses(repo, "doc1");
    states.sort();
    assert_eq!(
      states,
      [
        ("bad".into(), "open".into()),
        ("good".into(), "resolved".into())
      ]
    );
  }

  #[tokio::test]
  async fn re_export_discards_unposted_comments_only() {
    let server = mock().await;
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_str().unwrap();
    let exports = tempfile::tempdir().unwrap();
    use_test_exports_dir(exports.path());
    std::fs::create_dir_all(review_root("doc1").unwrap()).unwrap();
    add_comment(repo, "doc1", "stale");
    let posted = add_comment(repo, "doc1", "posted");
    crate::local_db::resolve_agent_review_comment(repo, &posted).unwrap();
    Mock::given(method("GET"))
      .and(path("/drive/v3/files/doc1"))
      .respond_with(
        ResponseTemplate::new(200)
          .set_body_json(json!({"id": "doc1", "name": "Spec", "mimeType": GOOGLE_DOC_MIME})),
      )
      .mount(&server)
      .await;
    Mock::given(method("GET"))
      .and(path("/drive/v3/files/doc1/export"))
      .respond_with(ResponseTemplate::new(200).set_body_raw("# New\n", "text/markdown"))
      .mount(&server)
      .await;

    let prepared = prepare_doc_review(&local("tok"), repo, "doc1")
      .await
      .unwrap();
    assert_eq!(prepared.file_name, "Spec.md");
    assert_eq!(
      statuses(repo, "doc1"),
      [("posted".into(), "resolved".into())]
    );
  }
}
