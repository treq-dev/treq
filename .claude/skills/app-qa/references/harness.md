# How the harness works

Part of the `app-qa` skill.

1. `createTestRepo()` (from `test/utils`, backed by the `tauri-test` addon) creates a
   real jj repository on disk, exactly like an integration test.
2. `render(<Dashboard/>)` (from `test/test-utils`) mounts the real React tree in
   jsdom, with Tauri's `invoke` replaced by real Rust dispatch
   (`test/setup.screenshot.ts`) — no mocked backend, no mocked ShowWorkspace,
   FileBrowser, ChangesDiffViewer, etc.
3. `captureDocument(document, { name, expectations })` (`scripts/screenshot/capture.ts`)
   serializes the live DOM, inlines the app's real compiled Tailwind CSS
   (`scripts/screenshot/build-css.mjs` output), and hands the resulting static HTML to
   headless Chromium (`playwright-core`, pinned to the pre-installed browser) purely
   to rasterize it into a PNG. jsdom itself never paints a pixel — Chromium is only
   there for the pixels. It also writes `<name>.json` next to the PNG recording the
   `expectations` you passed (see step 3 in `SKILL.md`).

`test/setup.screenshot.ts` is a near-duplicate of `test/setup.integration.ts` with one
difference: `test/integration/**` fails a run the moment any still-un-migrated `jj_*`
command is invoked (an ongoing tracker for code that should call `core::*` instead).
The screenshot harness exists to show current real behavior, debt included, so it
only logs which `jj_*` commands fired instead of failing the spec. If driving a real
flow hits an unknown command, that command is missing from `generate_handler!` or
from a `#[tauri::command]` the `tauri-test` setup scan can see — add the real
command, not a test-only stub.
