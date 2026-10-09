//! Theme setup: follow the system light/dark mode, phone-sized type.

use gpui_kit::{component::Theme, px, App};

pub fn init(cx: &mut App) {
  Theme::sync_system_appearance(None, cx);
  let theme = Theme::global_mut(cx);
  theme.font_size = px(15.);
  theme.mono_font_size = px(12.);
  #[cfg(target_os = "android")]
  {
    theme.mono_font_family = "Droid Sans Mono".into();
  }
}
