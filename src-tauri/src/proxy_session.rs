//! The Supabase session the Rust clients send to treq's OAuth proxy Edge
//! Functions (`linear-proxy`, `google-proxy`). The frontend pushes it on
//! sign-in and every token refresh; pollers read it without a command in
//! flight. It is never logged. One session serves both proxies.

use std::sync::RwLock;

#[derive(Clone, Debug, PartialEq)]
pub struct ProxySession {
  pub supabase_url: String,
  pub access_token: String,
}

impl ProxySession {
  /// URL of an Edge Function on this session's Supabase project.
  pub fn function_url(&self, name: &str) -> String {
    format!("{}/functions/v1/{name}", self.supabase_url)
  }
}

/// The session shared by the Linear and Google clients.
pub static SESSION: ProxySessionSlot = ProxySessionSlot::new();

/// Sets, or clears on sign-out, the shared session.
pub fn set(supabase_url: Option<String>, access_token: Option<String>) {
  SESSION.set(supabase_url, access_token);
}

pub fn get() -> Option<ProxySession> {
  SESSION.get()
}

/// The bearer token goes to this URL, so only https is accepted, plus plain
/// http on loopback for a local Supabase stack.
fn allowed_url(raw: &str) -> bool {
  let Ok(url) = url::Url::parse(raw) else {
    return false;
  };
  match url.scheme() {
    "https" => url.host_str().is_some_and(|h| !h.is_empty()),
    "http" => matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
    _ => false,
  }
}

pub struct ProxySessionSlot(RwLock<Option<ProxySession>>);

impl Default for ProxySessionSlot {
  fn default() -> Self {
    Self::new()
  }
}

impl ProxySessionSlot {
  pub const fn new() -> Self {
    Self(RwLock::new(None))
  }

  /// Sets the session, or clears it (sign-out) when either part is missing.
  pub fn set(&self, supabase_url: Option<String>, access_token: Option<String>) {
    let session = match (supabase_url, access_token) {
      (Some(url), Some(token)) if allowed_url(url.trim()) && !token.is_empty() => {
        Some(ProxySession {
          supabase_url: url.trim().trim_end_matches('/').to_string(),
          access_token: token,
        })
      }
      _ => None,
    };
    match self.0.write() {
      Ok(mut guard) => *guard = session,
      Err(poisoned) => *poisoned.into_inner() = session,
    }
  }

  pub fn get(&self) -> Option<ProxySession> {
    match self.0.read() {
      Ok(guard) => guard.clone(),
      Err(poisoned) => poisoned.into_inner().clone(),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn set_normalizes_and_clears() {
    let slot = ProxySessionSlot::new();
    slot.set(Some(" https://x.supabase.co/ ".into()), Some("tok".into()));
    assert_eq!(
      slot.get().unwrap().function_url("google-proxy"),
      "https://x.supabase.co/functions/v1/google-proxy"
    );
    slot.set(Some("https://x".into()), None);
    assert!(slot.get().is_none());
  }

  #[test]
  fn set_rejects_non_https_urls() {
    let slot = ProxySessionSlot::new();
    for url in [
      "http://evil.example",
      "ftp://x.supabase.co",
      "not a url",
      "",
      "http://127.0.0.1.evil.example",
    ] {
      slot.set(Some("https://ok.supabase.co".into()), Some("tok".into()));
      slot.set(Some(url.into()), Some("tok".into()));
      assert!(slot.get().is_none(), "{url} was accepted");
    }
    for url in [
      "http://127.0.0.1:54321",
      "http://localhost:54321",
      "https://x.supabase.co",
    ] {
      slot.set(Some(url.into()), Some("tok".into()));
      assert!(slot.get().is_some(), "{url} was rejected");
    }
  }
}
