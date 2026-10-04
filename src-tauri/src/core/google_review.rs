//! Reviewing Google Drive files with the review agent: export a file outside
//! any repo, then post the agent's findings back as Drive comments.

use std::path::PathBuf;

use serde::Serialize;

use crate::google::*;

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

/// Short, stable name for a repo: the start of the SHA-256 of its
/// canonical path, so two repos reviewing one file get separate exports.
pub fn repo_key(repo_path: &str) -> String {
  use sha2::Digest;
  let canonical = std::fs::canonicalize(repo_path)
    .map(|p| p.to_string_lossy().into_owned())
    .unwrap_or_else(|_| repo_path.to_string());
  sha2::Sha256::digest(canonical.as_bytes())
    .iter()
    .take(8)
    .map(|b| format!("{b:02x}"))
    .collect()
}

/// Directory one Drive file is exported into for review from one repo:
/// `<exports>/<repo key>/<file id>`.
pub fn review_root(repo_path: &str, file_id: &str) -> Result<PathBuf, String> {
  if !valid_file_id(file_id) {
    return Err(format!("Invalid Google Drive file id '{file_id}'"));
  }
  Ok(exports_root()?.join(repo_key(repo_path)).join(file_id))
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
  /// Open findings that existed before this export. The caller discards
  /// exactly these once the new review has launched, so findings the new
  /// agent writes in the meantime are never deleted.
  pub stale_finding_ids: Vec<String>,
}

/// Exports the file into the review directory, replacing an earlier export.
pub async fn prepare_doc_review(
  source: &GoogleSource,
  repo_path: &str,
  file_id: &str,
) -> Result<PreparedDocReview, String> {
  let root = review_root(repo_path, file_id)?;
  let file = get_drive_file(source, file_id).await?;
  let text = export_text(source, &file).await?;
  let file_name = review_file_name(&file);
  if root.exists() {
    std::fs::remove_dir_all(&root).map_err(|e| format!("Failed to clear review directory: {e}"))?;
  }
  std::fs::create_dir_all(&root).map_err(|e| format!("Failed to create review directory: {e}"))?;
  std::fs::write(root.join(&file_name), &text)
    .map_err(|e| format!("Failed to write exported document: {e}"))?;
  let stale_finding_ids =
    crate::local_db::list_agent_review_comments(repo_path, REVIEW_TARGET_TYPE, file_id)?
      .into_iter()
      .filter(|c| c.status == "open")
      .map(|c| c.id)
      .collect();
  Ok(PreparedDocReview {
    stale_finding_ids,
    line_count: text.lines().count(),
    root: root.to_string_lossy().into_owned(),
    file_name,
    file,
  })
}

/// Reads a file of the export at post time, checked again rather than
/// trusting the path validated when the comment was added: the file could
/// since have been swapped for a symlink to something outside the export,
/// and its lines would then be quoted onto a shared document.
pub fn read_export(root: &std::path::Path, file: &str) -> Option<String> {
  let path = root.join(file);
  let meta = std::fs::symlink_metadata(&path).ok()?;
  if !meta.is_file() {
    return None;
  }
  let (path, root) = (path.canonicalize().ok()?, root.canonicalize().ok()?);
  if !path.starts_with(&root) {
    return None;
  }
  std::fs::read_to_string(path).ok()
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

/// Deletes the unposted findings for `file_id`. They point at lines of an
/// earlier export, so the caller runs this once a new review has launched;
/// `prepare_doc_review` keeps them so a failed launch loses nothing.
pub fn discard_unposted_findings(
  repo_path: &str,
  file_id: &str,
  finding_ids: &[String],
) -> Result<(), String> {
  crate::local_db::delete_open_agent_review_comments_in_target(
    repo_path,
    REVIEW_TARGET_TYPE,
    file_id,
    finding_ids,
  )
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct PostCommentsResult {
  pub posted: usize,
  /// One message per comment that was not posted; those stay open.
  pub errors: Vec<String>,
}

/// All open (unposted) agent findings on Google Docs in this repo.
pub fn list_doc_findings(
  repo_path: &str,
) -> Result<Vec<crate::local_db::AgentReviewComment>, String> {
  crate::local_db::list_open_agent_review_comments_of_type(repo_path, REVIEW_TARGET_TYPE)
}

/// Posts the open agent comments for `file_id` to Drive. A failure does not
/// stop the rest; failed comments stay open with one error each.
///
/// Each comment is claimed (resolved, only if still open) before it is sent
/// and reopened if sending fails. That makes a double-clicked or concurrent
/// post send each comment once, at the cost that a crash between claim and
/// send leaves a comment resolved but unposted. We prefer that over the
/// reverse order, where a crash or a lost response after a successful send
/// would post a duplicate onto a document other people read.
pub async fn post_review_comments(
  source: &GoogleSource,
  repo_path: &str,
  file_id: &str,
) -> Result<PostCommentsResult, String> {
  let root = review_root(repo_path, file_id)?;
  let comments =
    crate::local_db::list_agent_review_comments(repo_path, REVIEW_TARGET_TYPE, file_id)?;
  let mut result = PostCommentsResult::default();
  for comment in comments.iter().filter(|c| c.status == "open") {
    let Some(text) = read_export(&root, &comment.file_path) else {
      result.errors.push(format!(
        "{}: export missing; run Review again",
        comment.file_path
      ));
      continue;
    };
    let claimed = crate::local_db::resolve_agent_review_comment_in_target(
      repo_path,
      REVIEW_TARGET_TYPE,
      file_id,
      &comment.id,
    );
    match claimed {
      Ok(true) => {}
      // Another post already claimed it.
      Ok(false) => continue,
      Err(e) => {
        result.errors.push(e);
        continue;
      }
    }
    let quote = quoted_lines(&text, comment.start_line, comment.end_line);
    match create_comment(source, file_id, &comment_content(comment), quote.as_deref()).await {
      Ok(_) => result.posted += 1,
      Err(e) => {
        if let Err(reopen) = crate::local_db::reopen_agent_review_comment_in_target(
          repo_path,
          REVIEW_TARGET_TYPE,
          file_id,
          &comment.id,
        ) {
          result.errors.push(reopen);
        }
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
    assert!(review_root("/repo", "../etc").is_err());
    assert!(review_root("/repo", "").is_err());
    assert_eq!(
      review_root("/repo", "abc_D-1").unwrap(),
      std::path::Path::new("/docs/treq/exports")
        .join(repo_key("/repo"))
        .join("abc_D-1")
    );
  }

  #[test]
  fn review_root_differs_per_repo() {
    use_test_exports_dir(std::path::Path::new("/docs/treq/exports"));
    assert_ne!(
      review_root("/repo-a", "doc").unwrap(),
      review_root("/repo-b", "doc").unwrap()
    );
    assert_eq!(repo_key("/repo-a"), repo_key("/repo-a"));
    assert_eq!(repo_key("/repo-a").len(), 16);
  }

  #[tokio::test]
  async fn missing_export_keeps_comment_open_and_posts_nothing() {
    let server = mock().await;
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_str().unwrap();
    let exports = tempfile::tempdir().unwrap();
    use_test_exports_dir(exports.path());
    add_comment(repo, "doc1", "orphan");
    Mock::given(method("POST"))
      .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "c"})))
      .expect(0)
      .mount(&server)
      .await;
    let result = post_review_comments(&local("tok"), repo, "doc1")
      .await
      .unwrap();
    assert_eq!(result.posted, 0);
    assert_eq!(result.errors, ["doc.md: export missing; run Review again"]);
    assert_eq!(statuses(repo, "doc1"), [("orphan".into(), "open".into())]);
  }

  #[tokio::test]
  async fn success_without_comment_id_counts_as_posted() {
    let server = mock().await;
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_str().unwrap();
    let exports = tempfile::tempdir().unwrap();
    use_test_exports_dir(exports.path());
    let root = review_root(repo, "doc1").unwrap();
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("doc.md"), "Line one\n").unwrap();
    add_comment(repo, "doc1", "note");
    Mock::given(method("POST"))
      .and(path("/drive/v3/files/doc1/comments"))
      .respond_with(ResponseTemplate::new(204))
      .expect(1)
      .mount(&server)
      .await;
    let result = post_review_comments(&local("tok"), repo, "doc1")
      .await
      .unwrap();
    assert_eq!(result.posted, 1);
    assert_eq!(statuses(repo, "doc1"), [("note".into(), "resolved".into())]);
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
    let root = review_root(repo, "doc1").unwrap();
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
  async fn re_export_keeps_findings_until_discarded() {
    let server = mock().await;
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_str().unwrap();
    let exports = tempfile::tempdir().unwrap();
    use_test_exports_dir(exports.path());
    std::fs::create_dir_all(review_root(repo, "doc1").unwrap()).unwrap();
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
    assert_eq!(list_doc_findings(repo).unwrap().len(), 1);
    assert_eq!(prepared.stale_finding_ids.len(), 1);
    add_comment(repo, "doc2", "other");
    // Written by the new agent after prepare: must survive the discard.
    add_comment(repo, "doc1", "fresh");
    discard_unposted_findings(repo, "doc1", &prepared.stale_finding_ids).unwrap();
    let mut doc1 = statuses(repo, "doc1");
    doc1.sort();
    assert_eq!(
      doc1,
      [
        ("fresh".into(), "open".into()),
        ("posted".into(), "resolved".into())
      ]
    );
    let mut open: Vec<_> = list_doc_findings(repo)
      .unwrap()
      .into_iter()
      .map(|c| c.target_id)
      .collect();
    open.sort();
    assert_eq!(open, ["doc1", "doc2"]);
  }

  #[test]
  fn read_export_refuses_symlinks_and_escapes() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("doc.md"), "ok\n").unwrap();
    std::fs::write(outside.path().join("secret"), "token\n").unwrap();
    assert_eq!(read_export(root.path(), "doc.md").as_deref(), Some("ok\n"));
    assert_eq!(read_export(root.path(), "../secret"), None);
    #[cfg(unix)]
    {
      std::os::unix::fs::symlink(outside.path().join("secret"), root.path().join("link.md"))
        .unwrap();
      assert_eq!(read_export(root.path(), "link.md"), None);
    }
  }
}
