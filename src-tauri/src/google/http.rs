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

/// What a request returns: JSON, or raw text for Drive exports.
pub(crate) enum Body {
  Json(Value),
  Text(String),
}

pub(crate) async fn send(
  source: &GoogleSource,
  method: reqwest::Method,
  url: &str,
  body: Option<&Value>,
) -> Result<Body, String> {
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
  let response = request.timeout(REQUEST_TIMEOUT).send().await.map_err(|e| {
    if e.is_timeout() {
      "Google request timed out".to_string()
    } else {
      format!("Failed to reach Google: {e}")
    }
  })?;
  let status = response.status();
  let is_json = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .is_some_and(|v| v.contains("json"));
  let text = response
    .text()
    .await
    .map_err(|e| format!("Failed to read Google response: {e}"))?;
  if !status.is_success() {
    return Err(error_message(
      status,
      &text,
      matches!(source, GoogleSource::Proxy(_)),
    ));
  }
  if text.is_empty() {
    return Ok(Body::Json(Value::Null));
  }
  if is_json {
    serde_json::from_str(&text)
      .map(Body::Json)
      .map_err(|e| format!("Failed to parse Google response: {e}"))
  } else {
    Ok(Body::Text(text))
  }
}

pub(crate) async fn send_json(
  source: &GoogleSource,
  method: reqwest::Method,
  url: &str,
  body: Option<&Value>,
) -> Result<Value, String> {
  match send(source, method, url, body).await? {
    Body::Json(value) => Ok(value),
    Body::Text(_) => Err("Google returned an unexpected response".to_string()),
  }
}

pub(crate) fn error_message(status: reqwest::StatusCode, text: &str, via_proxy: bool) -> String {
  let parsed = serde_json::from_str::<Value>(text).ok();
  // Google: {"error":{"message":…}}; proxy: {"error":"…"}.
  let message = parsed.as_ref().and_then(|v| {
    v.pointer("/error/message")
      .or_else(|| v.get("error"))
      .and_then(Value::as_str)
      .map(str::to_string)
  });
  match (status.as_u16(), message) {
    // The proxy explains a lapsed Google grant itself ("Reconnect Google
    // Workspace…"); only a bare 401 means the treq session was rejected.
    (401, Some(message)) if via_proxy => message,
    (401, None) if via_proxy => {
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

pub(crate) fn enc(segment: &str) -> String {
  url::form_urlencoded::byte_serialize(segment.as_bytes()).collect()
}
