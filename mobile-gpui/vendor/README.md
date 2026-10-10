# Vendored crates

## gpui-component 0.7.1

Copied from crates.io (`gpui-component` 0.7.1, the crate in longbridge/gpui-kit
at `crates/component`) and wired in through `[patch.crates-io]` in
`../Cargo.toml`. `tests/`, `Cargo.lock` and `Cargo.toml.orig` are dropped, along
with the `[[test]]` targets in `Cargo.toml` that pointed at `tests/`.

Why: on touch selection, `Input` draws its own GPUI edit menu (Cut, Copy, Paste,
Select all) with no way to turn it off. On Android, `tauri-plugin-gpui` already
shows the platform's native selection toolbar for focused inputs, so users would
see two menus.

The change, in `src/input/input.rs`, `Input::render_touch_selection`: on
`target_os = "android"`, clear the menu items before building the
`TouchSelectionOverlay`. The overlay then draws the selection handles only,
because `TouchSelectionOverlay::into_elements` skips the menu when `items` is
empty. Other platforms are unchanged, and so is the plain-text menu in
`window_overlay.rs`.

To drop this: once upstream has an opt-out, delete `vendor/`, remove the
`[patch.crates-io]` section from `Cargo.toml` and run `cargo update -p
gpui-component`.
