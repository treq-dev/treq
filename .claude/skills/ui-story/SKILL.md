---
name: ui-story
description: >-
  Create or update Storybook stories that mount a treq component purely from
  props (no jj repo, Tauri IPC, or NAPI). Use on /ui-story, when asked to add
  a story or storybook a component, or to give a component a Cloudflare Pages
  preview.
---

# ui-story (Storybook stories for treq components)

## What this skill is for

Storybook here exists to let a reviewer *see* a changed presentational
component in isolation — different props, different variants, light/dark —
without running the full Tauri app or a real jj repo. It is not a
replacement for `/app-qa`, which verifies real app behavior against a real
repo. If the component you're working on can't be meaningfully rendered
without live app state (a `useQuery` hook, `invoke()` calls, `ThemeProvider`
context that reads settings from the Rust backend, etc.), that's a signal
it isn't presentational yet — either stub/inject that dependency via props,
or skip Storybook for it and rely on `/app-qa` instead.

## Setup already in place

- `.storybook/main.ts` — stories glob is `src/**/*.stories.@(ts|tsx)`,
  framework is `@storybook/react-vite`.
- `.storybook/preview.tsx` — imports `src/index.css` (Tailwind + the app's
  CSS variables), and adds a toolbar **Theme** control that toggles the
  `.dark` class on `<html>`, matching how `useTheme` applies dark mode in
  the real app. Stories automatically get real treq styling in both themes
  without needing `ThemeProvider`.
- `npm run storybook` — dev server on port 6006.
- `npm run build-storybook` — static build to `storybook-static/` (what CI
  deploys).
- Example: `src/components/ui/button.stories.tsx`.

## Where stories live

Colocate the story next to the component it documents:
`src/components/ui/button.tsx` → `src/components/ui/button.stories.tsx`.
Same for components under `src/components/**` (e.g.
`src/components/WorkspacePicker.tsx` →
`src/components/WorkspacePicker.stories.tsx`).

## Writing a story

1. **Read the component first.** Identify its props interface and which
   props are purely presentational (strings, booleans, enums, render
   callbacks) vs. which pull in app state (hooks like `useTheme`,
   `useWorkspace`, TanStack Query, or `invoke()` from `src/lib/api`).
2. **If the component takes app-state hooks directly** (not via props),
   don't fight it inside the story. Prefer, in order:
   - Check if the component already separates a presentational piece from
     a container (e.g. `FooView` vs `Foo`) — story the presentational one.
   - If no such split exists and the component is a good candidate for one
     (its own logic is small and the hook usage is incidental), propose
     extracting a presentational subcomponent, but confirm with the user
     before doing a nontrivial refactor — don't do it silently as a side
     effect of "just adding a story."
   - Otherwise, mock only what's needed via a decorator (e.g. wrap in a
     minimal context provider with fixed values) rather than pulling in the
     real provider stack.
3. **Model args on the real prop types.** Use `satisfies Meta<typeof
   Component>` and derive `argTypes` from the actual variant/size/enum
   unions in the component (see `button.stories.tsx` for the pattern with
   `class-variance-authority` variants) — don't invent props that don't
   exist.
4. **Make `Default` a kitchen sink.** Rather than a single instance with
   default args, give `Default` a custom `render` that lays out every
   variant × size (or the component's equivalent axes) in a grid, plus a
   disabled state where applicable — see `button.stories.tsx`. That's the
   one screenshot a reviewer looks at to see the whole component at a
   glance. Set `parameters: { controls: { disable: true } }` on it since a
   fixed grid isn't meant to be driven by the args table. Still add
   separate single-instance stories per notable variant/state (disabled,
   error, empty, long-content) — those are what the controls panel and
   autodocs args table drive, and what a reviewer clicks into for a closer
   look at one case.
5. **Use `tags: ["autodocs"]`** on the meta so Storybook's docs page is
   generated for free.
6. Do not add global decorators or providers to `.storybook/preview.tsx`
   for a single component's needs — keep shared setup shared, keep
   component-specific mocking local to that story file.

## Verifying: always screenshot the change

Don't just confirm `build-storybook` succeeds — look at the rendered
result. Every time you add or tweak a story (new story, changed args,
changed component markup/styles), capture it with the screenshot harness
and view the PNGs before telling the user the change is done:

```
npm run storybook:screenshot -- src/components/ui/button.stories.tsx
```

This builds Storybook, serves `storybook-static/` locally, and uses the
repo's existing headless-Chromium setup (same `playwright-core` +
`PLAYWRIGHT_CHROMIUM_PATH` as `scripts/screenshot/`) to capture each story
in both light and dark to `scripts/storybook/.generated/<story-id>.<light|
dark>.png` plus a `manifest.json`. Pass one or more repo-relative
`*.stories.tsx` paths or exact story ids (from `storybook-static/
index.json`) as args; no args captures every story, which is slow — scope
it to the story file(s) you touched.

Read the resulting PNGs yourself (`Read` tool on the `.png` paths) — that's
the whole point, an agent-written "looks fine" without looking is not
verification. When tweaking an *existing* component, capture before your
change and after, and compare the two images directly rather than relying
on memory of what it looked like.

`scripts/storybook/.generated/` is gitignored scratch output, not part of
the story itself.

## Prototyping variations for the user to choose from

When the user asks for **variations** of a component to pick from (a new
look, a redesigned layout, alternative styling for something that doesn't
exist yet), don't just write one guess and iterate in place. Produce **at
least 4 distinct options**:

1. Make each option a real, separate story (e.g. `Prototype1`, `Prototype2`
   ... or descriptive names like `Compact`, `Card`, `Inline`, `WithIcon` —
   prefer names that describe what's different about each one) inside the
   component's `.stories.tsx`, or a dedicated `<Component>.prototypes.
   stories.tsx` file if the component itself doesn't exist yet and you're
   prototyping a new one from scratch.
2. Make the options meaningfully different from each other — different
   layout, density, or visual treatment, not four color tweaks of the same
   idea — so the screenshots actually help someone decide.
3. Screenshot every option with `npm run storybook:screenshot -- <file>`
   (light is usually enough for a first pass; add dark if theme handling is
   part of what's being decided).
4. Present the screenshots to the user side by side with a one-line
   description of what's different about each, and ask which direction to
   pursue (or if they want to mix elements of a couple).
5. Once the user picks (or narrows down), keep the winning story and delete
   the rejected prototype stories rather than leaving dead options in the
   file — a merged component shouldn't carry four alternate stories nobody
   picked.

## Shared-components long-term note

`web/` (the Docusaurus marketing/docs site) does not yet share components
or Tailwind config with the app. When a component you're storying is
genuinely generic UI (not treq-specific business logic) and you notice it
duplicates something in `web/`, mention it, but don't attempt the
extraction into a shared package as part of a story-writing task — that's
a separate, larger migration.
