//! Test-only sink for events the app would normally `emit` through the Tauri
//! `AppHandle`. The `tauri-test` harness has no `AppHandle`, so PTY output is
//! queued here instead and drained by the JS test harness, which feeds it to
//! the mocked `listen()`.
//!
//! PTYs only spawn in tests when `TREQ_TEST_PTY=1`, so tests that do not opt
//! in keep their old behavior of never starting a shell.

use std::sync::Mutex;

use crate::lock_ext::LockExt;

static EVENTS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// Whether PTY sessions should really spawn when there is no `AppHandle`.
pub fn pty_enabled() -> bool {
  std::env::var("TREQ_TEST_PTY").as_deref() == Ok("1")
}

pub fn push(event: &str, payload: String) {
  EVENTS.lock_or_recover().push((event.to_string(), payload));
}

/// Takes every queued event, oldest first.
pub fn drain() -> Vec<(String, String)> {
  std::mem::take(&mut *EVENTS.lock_or_recover())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn drain_returns_pushed_events_in_order_and_empties_the_queue() {
    // Other tests never push to this sink, so the queue holds only ours.
    drain();
    push("pty-data-a", "one".to_string());
    push("pty-data-b", "two".to_string());

    assert_eq!(
      drain(),
      vec![
        ("pty-data-a".to_string(), "one".to_string()),
        ("pty-data-b".to_string(), "two".to_string()),
      ]
    );
    assert!(drain().is_empty());
  }
}
