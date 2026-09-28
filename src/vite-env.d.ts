/// <reference types="vite/client" />
/// <reference types="@testing-library/jest-dom" />

interface ImportMetaEnv {
  /** Set by the Tauri CLI for the target being built; see `lib/mobile-platform.ts`. */
  readonly TAURI_ENV_PLATFORM?: string;
}
