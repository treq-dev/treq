---
name: app-qa
description: >-
  Visually verify treq UI/behavior changes by driving the real app (real jj repo via
  NAPI, real Rust dispatch, jsdom-rendered React) with @testing-library/user-event and
  capturing before/after screenshots through the Chromium rasterization harness in
  scripts/screenshot/. Use explicitly when the user runs /app-qa or asks to screenshot,
  QA, or visually check a behavior. ALSO use proactively, without being asked, right
  after implementing or modifying anything that changes rendered UI or user-facing
  interaction: components under src/components/**, hooks under src/hooks/**,
  src/lib/** helpers that affect rendering, or Tauri commands under
  src-tauri/src/commands/** and src-tauri/src/core/** that back a UI flow. Do this
  before telling the user the change is done. A PostToolUse hook
  (.claude/hooks/post-edit-app-qa.sh) injects a reminder for exactly this case — treat
  that reminder as the trigger to run this skill, not just a suggestion.
---

# App QA (screenshot-verified behavior checks)

## When to use

- User invokes `/app-qa`, optionally naming a flow or component ("app-qa the workspace
  picker", "app-qa the merge conflict banner").
- Proactively, immediately after an Edit/Write/MultiEdit that changes UI-affecting
  code — don't wait to be asked. If you see `additionalContext` from
  `post-edit-app-qa.sh` naming a changed file, that *is* the request.

## Delegate grunt work and discovery to cheaper subagents

Most of the cost of an app-qa run is search and mechanical legwork, not judgement. Push
that to subagents on a cheaper model (`Agent` with `model: "haiku"`, or `"sonnet"` when
the answer needs some reasoning) and keep the expensive context for the parts that
actually need it. Run independent delegations in parallel in a single message.

Good candidates — hand these off:

- **Finding prior art.** Which `test/integration/**` or `test/*.test.tsx` scenario
  already builds the repo/workspace state this spec needs; whether a spec under
  `scripts/screenshot/specs/` already covers this flow; which spec is the closest
  shape to copy. Use `Explore` — it's read-only and returns the conclusion instead of
  dumping files.
- **Locating selectors and wiring.** The `data-testid`, accessible role, or button
  label to drive; which component renders a given piece of copy; which UI flow a
  changed `src-tauri/` or `src/lib/` file actually backs.
- **Tracing command gaps.** When a flow fails inside `invoke`, have a subagent
  find the corresponding `#[tauri::command]` and `core::*` function. `tauri-test`
  dispatches the real command; there is no separate `dispatch.rs` match table.
- **Mechanical sweeps.** Reading a batch of `<name>.json` manifests, chasing down
  which spec produced which capture, diffing a spec against the one you're copying.

Ask for the specific fact you need ("which test file creates a repo with a conflicted
merge, and what does the setup look like") rather than "look into the test setup" —
a subagent starts cold and pays to re-derive whatever you don't tell it.

Keep these yourself — they are the skill, not the legwork:

- Deciding what behavior to verify and what the `expectations` should claim.
- Writing the spec and driving the flow with `userEvent`.
- **Step 5 verification.** Read the PNGs yourself. The whole point is that the agent
  shipping the change looks at the pixels; a subagent's "looks fine" is not that.
- The final report to the user.

## Ground rule: userEvent only, never fireEvent

Every interaction inside a spec must go through `@testing-library/user-event`
(`userEvent.setup()`, then `user.click`, `user.type`, `user.keyboard`, `user.hover`,
`user.tab`, ...). Never use `fireEvent` for driving the scenario.

`fireEvent` dispatches one synthetic DOM event. `userEvent` replays the sequence a
real user actually produces — pointerdown, focus, pointerup, click; or a real
per-character sequence of keydown/input/keyup for typing. Radix components, cmdk,
and treq's own focus/keyboard-shortcut handling key off that full sequence. A spec
that drives state with `fireEvent.click` can look green while the real app is broken
for a real user clicking the same button — it defeats the point of this skill.

This extends to *setup*, not just the behavior under test: if the scenario's
narrative includes "the user creates a workspace" (or renames one, deletes one,
etc.) as a step, create it by clicking through the real dialog (the "Stack" button
on the home repo header, or "Stack" on an existing workspace's header to create a
stacked child) rather than calling `createWorkspace()` from `src/lib/api` directly.
The API helper is still fine for *incidental background state* a spec needs but
isn't itself testing (e.g. two throwaway workspaces just so a branch-switcher
dropdown has something to list). `scripts/screenshot/specs/commits-tab-after-push.spec.tsx`
is the worked example: it drives the whole "Stack" dialog (open it, type a branch
name, submit) with `userEvent`, not the API helper, because workspace creation is
part of the scenario being verified.

## First-time environment setup (fresh sandbox/container)

A clean checkout is missing several things `npm run screenshot`/`build:napi` need.
Do this once per fresh environment, before step 4 below. Skip whatever is already
present (`node_modules/`, a working `cargo check`, etc.).

1. **Node deps**: `npm install` if `node_modules/` doesn't exist yet.

2. **Native build deps for the Tauri/GTK backend** (Linux sandboxes typically lack
   these): `libgtk-3-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`,
   `libwebkit2gtk-4.1-dev`. Install with `apt-get install -y <package>`; if apt
   reports unmet dependencies or 404s on individual `.deb`s, run `apt-get update`
   and then `apt-get install -y --fix-broken` to pull the rest in — a stale package
   index is the usual cause, not a real missing package.

3. **CA trust for the outbound proxy** (if the session runs behind the agent proxy
   described in `/root/.ccr/README.md`): the proxy's CA is dropped into
   `/usr/local/share/ca-certificates/` at container start, but the compiled system
   bundle (`/etc/ssl/certs/ca-certificates.crt`) can be stale. If a `cargo build`
   fails with a TLS error like `invalid peer certificate: UnknownIssuer` while
   fetching a crate's build-time download, run `update-ca-certificates --fresh` and
   retry — most such failures are this, not a real network block.

## How the harness works

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
   `expectations` you passed (see step 3 in Steps below).

`test/setup.screenshot.ts` is a near-duplicate of `test/setup.integration.ts` with one
difference: `test/integration/**` fails a run the moment any still-un-migrated `jj_*`
command is invoked (an ongoing tracker for code that should call `core::*` instead).
The screenshot harness exists to show current real behavior, debt included, so it
only logs which `jj_*` commands fired instead of failing the spec. If driving a real
flow hits an unknown command, that command is missing from `generate_handler!` or
from a `#[tauri::command]` the `tauri-test` setup scan can see — add the real
command, not a test-only stub.

## Steps

1. **Identify the behavior to verify.** From the user's ask, or from the changed
   file(s) named in the hook's `additionalContext`, work out which user-facing flow
   changed. Search `test/integration/**` and `test/*.test.tsx` for a scenario that
   already sets up the right repo/workspace state (`createTestRepo`, `commitRepoFile`,
   etc.) and reuse that setup instead of inventing your own — it's already proven to
   work against the real backend. Delegate that search to an `Explore` subagent per the
   section above; do the "which behavior matters" call yourself. Remember the rule
   above: if workspace creation is part of the scenario, drive it through the real UI,
   not `createWorkspace()`.

2. **Write or extend a spec** under `scripts/screenshot/specs/<slug>.spec.tsx`. One
   spec per behavior/flow. If an existing spec already covers this flow, add capture
   steps to it rather than duplicating the repo setup in a new file. Shape:

   ```tsx
   import * as React from "react";
   import { it } from "vitest";
   import userEvent from "@testing-library/user-event";
   import { createTestRepo, openRepo } from "../../../test/utils";
   import { render, screen, within } from "../../../test/test-utils";
   import { Dashboard } from "../../../src/components/Dashboard";
   import { captureDocument } from "../capture";

   it("captures <the behavior>", async () => {
     const { repoPath } = createTestRepo(false);
     openRepo(repoPath);
     // ... real repo setup via test/utils + src/lib/api; drive workspace
     // creation/deletion/etc. through the real UI if it's part of the scenario ...

     const user = userEvent.setup();
     render(<Dashboard />);

     // Real DOM assertions -- these prove the state is correct BEFORE capturing.
     // Separate from `expectations` below, which are about the picture, not the DOM.
     await screen.findByTestId("show-workspace-header");
     await captureDocument(document, {
       name: "<slug>-01-before",
       expectations: [
         "Plain-English claim about what this screenshot should show visually.",
         "A second claim, if there's more than one thing worth checking in the image.",
       ],
     });

     // Drive the flow -- ONLY user.* calls, never fireEvent.
     await user.click(await screen.findByRole("button", { name: "..." }));
     await screen.findByText("..."); // wait for the resulting DOM change
     await captureDocument(document, {
       name: "<slug>-02-after",
       expectations: ["What changed, stated as a visual claim about the after image."],
     });
   }, 60000);
   ```

   `scripts/screenshot/specs/workspace-branch-switch.spec.tsx` is a worked example of
   the userEvent + multi-step-capture shape. `commits-tab-after-push.spec.tsx` is the
   worked example of driving workspace creation through the real "Stack" dialog. Copy
   whichever shape fits.

   Give every capture a numbered, descriptive `name` — that string becomes the PNG
   (and manifest JSON) filename, so name it as `<slug>-<NN>-<what-it-shows>`.

3. **`expectations` are for the picture, not the DOM.** `captureDocument` requires a
   non-empty `expectations: string[]` — plain-English claims about what a viewer
   should be able to confirm by *looking at the screenshot* (colors, layout, which
   button is visible, what a toast says, whether a list has the right items). These
   are not code assertions and `captureDocument` does not execute them; they're
   written to `<name>.json` next to the PNG specifically so that step 5 has a
   concrete, per-screenshot checklist instead of "eyeball it and hope you notice
   something wrong." Keep the real `screen.findBy*`/`expect` calls in the spec body
   too (still required, still what proves the DOM reached that state) — the two are
   complementary, not a replacement for each other.

   **At most 3 expectations per capture** — enforced by the
   `max-3-capture-document-expectations` ast-grep rule. Three claims is what a
   reviewer actually re-reads against an image; a list of eight gets skimmed. If a
   screenshot genuinely needs more than three, that is a sign it is showing more
   than one thing: take a second capture with its own `name` and split the claims
   across the two.

4. **Run it.** If this is a fresh environment (no `node_modules/`, or `cargo build`
   fails on GTK/webkit headers), do the "First-time environment setup" section
   above first.
   - First run in a session, or after touching `src-tauri`, or
     adding new Tailwind classes: `npm run screenshot` (rebuilds the NAPI addon,
     recompiles CSS, runs every spec — slow but complete).
   - Fast iteration on one spec once the addon/CSS are already built:
     `npx vitest run --config vitest.screenshot.config.ts scripts/screenshot/specs/<slug>.spec.tsx`
   - If only Tailwind classes changed (no Rust change): `npm run screenshot:css` first,
     then the targeted vitest run above.

5. **Verify each screenshot against its expectations before saying the task is done.**
   For every capture: read `scripts/screenshot/.generated/<name>.json` for its
   expectations list, then read `scripts/screenshot/.generated/<name>.png` (multimodal
   Read) and go through the list confirming or refuting each one against what the
   image actually shows. A spec whose `expect`/`findBy*` calls all passed can still
   render a visibly broken layout, a missing state, or wrong copy — that's a real bug
   to fix, not a false alarm, and the expectations checklist is what catches it
   instead of a cursory glance.

6. **Show the result.** Use SendUserFile to deliver the before/after PNGs together,
   with a short caption naming what changed and what to look at, and call out any
   expectation that didn't hold.

7. **Lint, format, and typecheck the whole change, last.** Only after the behavior is
   visually verified and shown, run:
   - `npm run format` — Biome (`./src ./test`) + `cargo fmt`, auto-fixes what it can.
   - `npm run lint` — oxlint + eslint over `./src ./test/integration`, plus
     `ast-grep scan --warning`.
   - `npm run check` — `tsc` (typecheck) + `ast-grep test`.

   Fix everything these flag — including in any spec file you added or extended in
   step 2. Doing this last, after all edits (source and spec) have settled, catches
   what an earlier check-then-edit ordering would miss and leaves the working tree in
   a genuinely clean state before you tell the user the task is done.

## Keep specs around

`scripts/screenshot/specs/` is a growing visual-regression library, not a scratch
directory. Don't delete a spec after using it — if a later change touches the same
flow, extend its capture steps instead of writing a near-duplicate file.
