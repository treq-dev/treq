//! Remote terminal (phase 2: persistent sessions, reattach, touch keys).

use gpui_kit::*;

use super::workspace::Target;
use crate::ui::{nav, widgets, Location};

pub fn open(target: Target, cx: &mut App) {
  let location = Location {
    repo: Some(target.repo.clone()),
    workspace: Some(crate::store::SnapshotWorkspace {
      id: target.id.clone(),
      name: target.name.clone(),
    }),
  };
  nav::push("Terminal", location, cx, move |_, cx| {
    cx.new(|_| TerminalScreen { _target: target })
  });
}

pub struct TerminalScreen {
  _target: Target,
}

impl Render for TerminalScreen {
  fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
    widgets::page().child(widgets::centered_message(
      "The terminal is coming in the next phase.",
      cx,
    ))
  }
}
