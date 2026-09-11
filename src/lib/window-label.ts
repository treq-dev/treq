import { getCurrentWindow } from "@tauri-apps/api/window";

/** Label of the Tauri window this code is running in, `"main"` as a fallback
 * for contexts without a real window (tests, the NAPI bridge). */
export function currentWindowLabel(): string {
  try {
    return getCurrentWindow()?.label ?? "main";
  } catch {
    return "main";
  }
}
