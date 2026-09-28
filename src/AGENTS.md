# Frontend Guide

**React 18** with no client-side router. Navigation is URL-search-param driven (`?repo=...`) and sidebar-based. `Dashboard` is the root container: it sets up providers, the repo URL param, and the file watcher.

## State management

- **SWR (`useSWR`)** for all async server state (Tauri commands, file watching, commit history)
- **Zustand** (`src/stores/`) for ambient client state (theme, zoom, diff/terminal settings, auth, editor apps, toasts, treq-send). Components select from `use*Store` directly. `AppStoreEffects` hydrates settings and attaches DOM/Tauri listeners. `ToastProvider` is a viewport over the toast store.

Tests for frontend changes follow `test/AGENTS.md`.
