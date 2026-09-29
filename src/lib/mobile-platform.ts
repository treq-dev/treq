// Which shell the app renders is a property of the build, not of the window
// size: a narrow desktop window is still desktop, with local repositories,
// PTYs and file watching, while an Android or iOS build has none of those.
//
// The Tauri CLI sets `TAURI_ENV_PLATFORM` (`android`, `ios`, `darwin`,
// `linux`, `windows`) while it runs the frontend build for a target, and
// `vite.config.ts` exposes `TAURI_ENV_*` variables to the bundle, so the
// value is fixed at build time.

const MOBILE_PLATFORMS = new Set(["android", "ios"]);

/** True when this bundle was built by the Tauri CLI for Android or iOS. */
export function isMobileBuild(): boolean {
  return MOBILE_PLATFORMS.has(import.meta.env.TAURI_ENV_PLATFORM ?? "");
}

/**
 * Whether to render the mobile shell. Mobile builds always do. A dev build
 * on desktop can preview it with `?shell=mobile` in the page URL; release
 * desktop builds ignore that parameter.
 */
export function shouldUseMobileShell(search: string): boolean {
  if (isMobileBuild()) return true;
  return (
    import.meta.env.DEV && new URLSearchParams(search).get("shell") === "mobile"
  );
}
