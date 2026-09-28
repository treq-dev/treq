# Treq Agent Guide

Treq is a **Tauri v2** Stacking Agent Development Environment (ADE) built on Jujutsu (jj). The frontend is React/TypeScript in `src/`; the backend is Rust in `src-tauri/`, exposed to the frontend via Tauri commands. A native Node addon (NAPI) runs the real Rust commands inside the frontend test suite.

Area guides (read the one for the area you are changing):
- `src/AGENTS.md` — frontend architecture and state management
- `src-tauri/AGENTS.md` — backend architecture, Rust tests, benchmarks
- `test/AGENTS.md` — frontend unit and integration test patterns

## Workflow Rules

- Use **npm** (not pnpm) for all JS commands
- Keep commands layer thin: no business logic in `commands/*.rs` — delegate to `core/`
- Never write commits; the user owns all VCS operations
- Prefer **jj-lib** or **gix** over subprocess calls; never shell out to `jj` or `git` from Rust
- `jj.rs` functions that accept a workspace path must validate the path exists and return an empty/default value on missing path rather than propagating an IO error

## TDD (Required)

All backend Rust work **must** follow TDD. Frontend work should too, where a test can be written before the feature.

1. Write a failing test that captures the desired behaviour
2. Run it — confirm the new test fails (and only the new test)
3. Write the minimum code to make it pass
4. Run tests — confirm all pass
5. Refactor while keeping tests green

Never write implementation code before the test exists. For a bug, reproduce it in a test first. Do not add tests for styling-only changes (classes, z-index, spacing, color): jsdom applies no stylesheets. Verify those with `/app-qa`.

| Work type | Test location |
|---|---|
| Rust core function | `#[cfg(test)]` in the same `.rs` file, or `src-tauri/tests/` |
| Tauri command | Rust test + integration test in `test/integration/` |
| React component | `test/integration/` for behaviour; `test/*.test.tsx` for isolated logic |
| Utility / pure function | `test/*.test.ts` |
| Performance-critical path | `src-tauri/benches/` |

## Running Tests

```bash
npm test                                     # full suite (builds NAPI first)
npm run test:run                             # frontend only (needs prior build:napi)
npm run build:napi                           # rebuild the addon after any Rust change
cargo test --manifest-path src-tauri/Cargo.toml
```
