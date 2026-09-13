use std::sync::{Mutex, MutexGuard};

/// Recovers a poisoned `Mutex` instead of panicking.
///
/// A single panic while holding one of the app-wide state locks (`state.db`
/// and friends) would otherwise poison it permanently: every later command
/// that tries to lock it panics too, bricking the app until restart. The
/// data behind a poisoned lock is still structurally valid — Rust doesn't
/// discard it on panic — so recovering it here is safe.
pub trait LockExt<T> {
  fn lock_or_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
  fn lock_or_recover(&self) -> MutexGuard<'_, T> {
    self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
  }
}
