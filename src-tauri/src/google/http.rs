//! Authenticated requests to Google, directly or through `google-proxy`.

use super::*;

#[cfg(test)]
thread_local! {
  // Rewrites `https://…googleapis.com` and the token URL to a mock server.
  pub(crate) static TEST_BASE: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

pub(crate) fn rewrite(url: &str) -> String {
  #[cfg(test)]
  if let Some(base) = TEST_BASE.with(|b| b.borrow().clone()) {
    for prefix in [TASKS_API, DRIVE_API, TOKEN_URL] {
      if let Some(rest) = url.strip_prefix(prefix) {
        let path = url::Url::parse(prefix)
          .expect("static URL")
          .path()
          .to_string();
        return format!("{base}{path}{rest}");
      }
    }
  }
  url.to_string()
}

pub(crate) fn token_url() -> String {
  rewrite(TOKEN_URL)
}

pub(crate) fn http_client() -> &'static reqwest::Client {
  static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
  CLIENT.get_or_init(|| {
    reqwest::Client::builder()
      .connect_timeout(CONNECT_TIMEOUT)
      .build()
      .unwrap_or_else(|_| reqwest::Client::new())
  })
}

const TOO_LARGE: &str = "Document too large to review (over 20 MB)";

/// Sends one request and returns the raw response body, unparsed.
pub(crate) async fn send_raw(
  source: &GoogleSource,
  method: reqwest::Method,
  url: &str,
  body: Option<&Value>,
) -> Result<String, String> {
  let request = match source {
    GoogleSource::Local {
      tokens,
      client_id,
      client_secret,
      token_db,
    } => {
      let token = local_access_token(tokens, client_id, client_secret, token_db).await?;
      let mut req = http_client()
        .request(method, rewrite(url))
        .bearer_auth(token);
      if let Some(body) = body {
        req = req.json(body);
      }
      req
    }
    GoogleSource::Proxy(session) => http_client()
      .post(session.function_url("google-proxy"))
      .bearer_auth(&session.access_token)
      .json(&json!({ "method": method.as_str(), "url": url, "body": body })),
  };
  let mut response = request.timeout(REQUEST_TIMEOUT).send().await.map_err(|e| {
    if e.is_timeout() {
      "Google request timed out".to_string()
    } else {
      format!("Failed to reach Google: {e}")
    }
  })?;
  let status = response.status();
  if response
    .content_length()
    .is_some_and(|len| len > MAX_RESPONSE_BYTES)
  {
    return Err(TOO_LARGE.to_string());
  }
  // Read in chunks so a body without a Content-Length is capped too.
  let mut bytes = Vec::new();
  while let Some(chunk) = response
    .chunk()
    .await
    .map_err(|e| format!("Failed to read Google response: {e}"))?
  {
    if (bytes.len() + chunk.len()) as u64 > MAX_RESPONSE_BYTES {
      return Err(TOO_LARGE.to_string());
    }
    bytes.extend_from_slice(&chunk);
  }
  let text = String::from_utf8_lossy(&bytes).into_owned();
  if !status.is_success() {
    return Err(error_message(
      status,
      &text,
      matches!(source, GoogleSource::Proxy(_)),
    ));
  }
  Ok(text)
}

/// Sends one request and parses the body as JSON; an empty body is `null`.
pub(crate) async fn send_json(
  source: &GoogleSource,
  method: reqwest::Method,
  url: &str,
  body: Option<&Value>,
) -> Result<Value, String> {
  let text = send_raw(source, method, url, body).await?;
  if text.trim().is_empty() {
    return Ok(Value::Null);
  }
  serde_json::from_str(&text).map_err(|e| format!("Failed to parse Google response: {e}"))
}

pub(crate) fn error_message(status: reqwest::StatusCode, text: &str, via_proxy: bool) -> String {
  let parsed = serde_json::from_str::<Value>(text).ok();
  let treq_session_rejected = parsed
    .as_ref()
    .and_then(|v| v.get("code"))
    .and_then(Value::as_str)
    == Some("treq_session");
  // Google: {"error":{"message":…}}; proxy: {"error":"…"}.
  let message = parsed.as_ref().and_then(|v| {
    v.pointer("/error/message")
      .or_else(|| v.get("error"))
      .and_then(Value::as_str)
      .map(str::to_string)
  });
  match (status.as_u16(), message) {
    // The proxy explains a lapsed Google grant itself ("Reconnect Google
    // Workspace…"); `code: "treq_session"` (or a bare 401) means it rejected
    // the treq session.
    (401, Some(message)) if via_proxy && !treq_session_rejected => message,
    (401, _) if via_proxy => {
      "treq could not authenticate with the Google proxy. Sign in to treq again.".to_string()
    }
    (401, _) => {
      "Google rejected the stored token. Reconnect Google Workspace in Settings.".to_string()
    }
    (429, _) => "Google rate limit reached. Try again in a minute.".to_string(),
    (_, Some(message)) => format!("Google: {message}"),
    _ => {
      let body: String = text.chars().take(300).collect();
      format!("Google API error ({status}): {body}")
    }
  }
}

/// Encodes a query parameter value.
pub(crate) fn enc(value: &str) -> String {
  url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

/// Encodes one path segment. Everything but `[A-Za-z0-9_~-]` is escaped,
/// dots included, so an id of `..` cannot climb out of its path.
pub(crate) fn seg(segment: &str) -> String {
  segment
    .bytes()
    .map(|b| match b {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'~' | b'-' => (b as char).to_string(),
      _ => format!("%{b:02X}"),
    })
    .collect()
}
