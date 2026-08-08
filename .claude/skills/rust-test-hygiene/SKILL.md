---
name: rust-test-hygiene
description: >-
  Apply treq's Rust test-suite standards when writing, reviewing, or cleaning
  up tests under src-tauri/ or crates/. Use when the user mentions "rust
  tests", "src-tauri/tests", "cargo test", "test hygiene", asks to review or
  add a Rust test, or asks to clean up/consolidate/dedupe Rust test coverage.
  Checks that a test asserts something real about treq (not the host OS, not
  serde itself, not a #[cfg(test)]-only helper), reuses TestRepo helpers from
  src-tauri/tests/e2e_test_helpers.rs instead of hand-rolled setup, avoids
  duplicating coverage that already exists elsewhere in the file or repo, and
  merges near-identical test clusters into a table-driven test instead of
  copy-pasting.
---

# Rust test hygiene

## When this runs

- Writing a new `#[test]` under `src-tauri/` or `crates/`.
- Reviewing a PR/diff that adds or changes Rust tests.
- Asked to clean up, consolidate, or dedupe Rust test coverage.

## 1. Does this test assert anything about treq?

Before writing the assertion, ask what would have to be broken in *treq's own
code* for this test to fail. If nothing in `src-tauri/src/**` or
`crates/**` (excluding `#[cfg(test)]` blocks) has to run, don't write it.

Reject/flag tests that:

- **Check the host environment**, not treq: e.g. asserting `git` or a binary
  is discoverable on `$PATH`, or that a path contains `/opt/homebrew/bin`.
  These pass or fail based on the machine, not the code.
- **Round-trip serde on a struct with no treq logic in the path.** A test
  that does `serde_json::from_str::<Foo>(literal)` and only checks the
  fields came back is testing serde, not treq — unless `Foo`'s
  `Deserialize` has custom logic (validation, defaulting, renames) that the
  test is specifically targeting.
- **Exercise a function that only exists for tests to call.** If the target
  function is `#[cfg(test)]`-gated (or `pub(super)`/private and reachable
  only from the test module) with zero production call sites, the test is
  asserting the helper matches itself. Either the helper should be deleted,
  or the test should drive it through the real production entry point
  instead.

Keep tests that exercise a real production code path — `core::*`,
`treq_lib::jj::*`, `dispatch.rs` handlers, CLI arg parsing that
`main`/Tauri commands actually call, etc. — even if the assertion is small.

## 2. Reuse `TestRepo` — don't hand-roll e2e/integration setup

Before writing setup code in `src-tauri/tests/*.rs`, check
`src-tauri/tests/e2e_test_helpers.rs` for an existing helper. It already
covers:

- Repo/workspace creation: `TestRepo::new()`, `TestRepo::new_without_init()`,
  `TestRepo::with_remote()`, `create_workspace_simple`,
  `create_workspace_with_commit`, `setup_workspace_with_pushed_commit`.
- Commits and file writes: `commit_file`, `commit_workspace_file`,
  `remote_commit_file`, `remote_commit_on_branch`, `create_file`,
  `write_workspace_file`, `append_workspace_file`.
- Running the `git`/`jj` binaries: `TestRepo::run_git`, `TestRepo::run_jj` —
  never shell out to `git`/`jj` directly or resolve the binary path yourself.
- Inspection: `get_log`, `get_current_bookmark`, `list_bookmarks`,
  `get_bookmark_commit_id`, `has_changes`, `get_status`,
  `verify_workspace_structure`, `file_exists_in_workspace`.

If none of these fit, add the new helper to `e2e_test_helpers.rs` rather
than inlining equivalent logic in a test file — the next test that needs it
should find it there.

## 3. Check for existing coverage before adding a test

Before writing a new test, grep the same file (and any file covering the
same module/command) for an existing test hitting the same code path or
scenario. Cross-file duplication is easy to miss because tests get added to
whichever file feels topically closest at the time. Specifically check:

- Does another `*_test.rs` file already cover this exact behavior under a
  different name (e.g. a general workspace test file and a narrower
  feature-specific one)?
- Is this "regression test for a disproven hypothesis" — i.e. does it
  duplicate what a more direct/primary test already asserts, just via a
  different code path that turned out not to matter? If so, the primary
  assertion is enough; don't keep the disproven-hypothesis version around
  as extra insurance.

If you find real overlap, delete the weaker/narrower duplicate and keep the
one with the clearer name and the more complete assertions — don't keep both
"just in case."

## 4. Table-driven tests over copy-paste clusters

If you're about to write 3+ tests that are structurally identical except for
literal inputs and expected outputs, merge them into one test that loops
over a `Vec` of named cases instead. Only reach for `rstest` if it's already
a dependency (check `Cargo.toml` / `src-tauri/Cargo.toml` first — as of this
writing it is not, so default to a plain loop).

Pattern to follow (mirrors `pty_tests.rs`):

```rust
#[test]
fn test_strip_ansi_codes_cases() {
    // Table-driven: each case is a (name, input, expected) triple.
    let cases: Vec<(&str, &str, &str)> = vec![
        ("plain text is untouched", "hello world", "hello world"),
        ("CSI color codes are stripped", "\x1b[32mhello\x1b[0m", "hello"),
        ("OSC title-setting sequence is stripped", "\x1b]0;title\x07text", "text"),
    ];

    for (name, input, expected) in cases {
        assert_eq!(strip_ansi_codes(input), expected, "case: {name}");
    }
}
```

For cases needing more than a couple of fields, use a `struct Case { name,
... , expected }` instead of a tuple — keep every case named descriptively
so a failure's `case: {name}` output tells you which scenario broke without
having to count array indices.

Don't merge tests that differ in more than inputs/outputs — if the *setup
shape* or *assertion structure* differs (not just values), keep them
separate; forcing a table-driven shape onto genuinely different scenarios
makes the test harder to read than the duplication it removes.

## 5. Quick checklist for a review pass

- [ ] Every new/changed test would fail if the corresponding treq code
      broke — not if the host machine or serde changed.
- [ ] No hand-rolled repo/workspace/commit setup that `TestRepo` already
      provides.
- [ ] No new test duplicates scenario coverage already in this file or a
      sibling `*_test.rs` file.
- [ ] Any cluster of 3+ near-identical tests is collapsed into one
      table-driven test (or uses `rstest` if already a dependency).
- [ ] Deleted/merged tests didn't drop an assertion that was the *only*
      coverage for some behavior — check the diff removes duplication, not
      unique coverage.
