//! Google Drive and Docs: listing, export and comments.

use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DriveFile {
  pub id: String,
  pub name: String,
  pub mime_type: String,
  pub modified_time: Option<String>,
  pub web_view_link: Option<String>,
  pub owner: Option<String>,
  /// Whether treq can export the file as text for review.
  pub reviewable: bool,
}

/// Google-native types are exported; plain text-like uploads are downloaded.
pub fn export_mime(mime: &str) -> Option<&'static str> {
  match mime {
    GOOGLE_DOC_MIME => Some("text/markdown"),
    "application/vnd.google-apps.presentation" => Some("text/plain"),
    "application/vnd.google-apps.spreadsheet" => Some("text/csv"),
    _ => None,
  }
}

pub(crate) fn is_text_like(mime: &str) -> bool {
  mime.starts_with("text/") || matches!(mime, "application/json" | "application/xml")
}

pub fn map_drive_file(v: &Value) -> Option<DriveFile> {
  let mime_type = str_field(v, "mimeType").unwrap_or_default();
  Some(DriveFile {
    id: str_field(v, "id")?,
    name: str_field(v, "name").unwrap_or_default(),
    reviewable: export_mime(&mime_type).is_some() || is_text_like(&mime_type),
    mime_type,
    modified_time: str_field(v, "modifiedTime"),
    web_view_link: str_field(v, "webViewLink"),
    owner: v
      .pointer("/owners/0/displayName")
      .and_then(Value::as_str)
      .map(str::to_string),
  })
}

/// Escapes a value for a Drive `q` string literal.
pub(crate) fn drive_literal(value: &str) -> String {
  value.replace('\\', "\\\\").replace('\'', "\\'")
}

pub fn drive_query(search: Option<&str>, docs_only: bool) -> String {
  let mut clauses = vec!["trashed = false".to_string()];
  if docs_only {
    clauses.push(format!("mimeType = '{GOOGLE_DOC_MIME}'"));
  } else {
    clauses.push("mimeType != 'application/vnd.google-apps.folder'".to_string());
  }
  if let Some(search) = search.map(str::trim).filter(|s| !s.is_empty()) {
    clauses.push(format!("fullText contains '{}'", drive_literal(search)));
  }
  clauses.join(" and ")
}

pub async fn list_drive_files(
  source: &GoogleSource,
  search: Option<&str>,
  docs_only: bool,
) -> Result<Vec<DriveFile>, String> {
  let q = drive_query(search, docs_only);
  // fullText search cannot be combined with orderBy.
  let order = if search.is_some_and(|s| !s.trim().is_empty()) {
    ""
  } else {
    "&orderBy=modifiedTime%20desc"
  };
  let url = format!(
    "{DRIVE_API}/files?pageSize=50&q={}{order}&fields={}&supportsAllDrives=true&includeItemsFromAllDrives=true",
    enc(&q),
    enc("files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))")
  );
  let value = send_json(source, reqwest::Method::GET, &url, None).await?;
  Ok(
    value
      .get("files")
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
      .filter_map(map_drive_file)
      .collect(),
  )
}

pub async fn get_drive_file(source: &GoogleSource, file_id: &str) -> Result<DriveFile, String> {
  let url = format!(
    "{DRIVE_API}/files/{}?supportsAllDrives=true&fields={}",
    enc(file_id),
    enc("id,name,mimeType,modifiedTime,webViewLink,owners(displayName)")
  );
  let value = send_json(source, reqwest::Method::GET, &url, None).await?;
  map_drive_file(&value).ok_or_else(|| "Google returned an invalid file".to_string())
}

pub async fn export_text(source: &GoogleSource, file: &DriveFile) -> Result<String, String> {
  let url = match export_mime(&file.mime_type) {
    Some(mime) => format!(
      "{DRIVE_API}/files/{}/export?mimeType={}",
      enc(&file.id),
      enc(mime)
    ),
    None if file.reviewable => format!(
      "{DRIVE_API}/files/{}?alt=media&supportsAllDrives=true",
      enc(&file.id)
    ),
    None => return Err(format!("'{}' cannot be reviewed as text", file.name)),
  };
  match send(source, reqwest::Method::GET, &url, None).await? {
    Body::Text(text) => Ok(text),
    Body::Json(value) => Ok(serde_json::to_string_pretty(&value).unwrap_or_default()),
  }
}

/// Posts one comment. `quoted` is the reviewed text the comment refers to;
/// Drive shows it as the comment's quote.
pub async fn create_comment(
  source: &GoogleSource,
  file_id: &str,
  content: &str,
  quoted: Option<&str>,
) -> Result<String, String> {
  let mut body = json!({ "content": content });
  if let Some(quoted) = quoted.filter(|q| !q.trim().is_empty()) {
    body["quotedFileContent"] = json!({ "mimeType": "text/plain", "value": quoted });
  }
  let value = send_json(
    source,
    reqwest::Method::POST,
    &format!("{DRIVE_API}/files/{}/comments?fields=id", enc(file_id)),
    Some(&body),
  )
  .await?;
  str_field(&value, "id").ok_or_else(|| "Google returned an invalid comment".to_string())
}
