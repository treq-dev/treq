//! The Supabase session the Rust clients send to treq's OAuth proxy Edge
//! Functions (`linear-proxy`, `google-proxy`). The frontend pushes it on
//! sign-in and every token refresh; pollers read it without a command in
//! flight. It is never logged.

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
      (Some(url), Some(token)) if !url.trim().is_empty() && !token.is_empty() => {
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
}
