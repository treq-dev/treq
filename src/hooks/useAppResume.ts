import { useEffect, useRef } from "react";

export interface AppResumeEvent {
  /** `visible`: the app came back to the foreground. `online`: the network returned. */
  reason: "visible" | "online";
  /** How long the page was hidden, or 0 when it was not hidden. */
  hiddenMs: number;
}

/**
 * Calls `onResume` when the app returns to the foreground or the network
 * comes back (mobile PRD, "App lifecycle"). Android and iOS suspend the
 * WebView when the app leaves the foreground, which shows up here as
 * `visibilitychange`. Tauri does not send the native resume event to the
 * frontend by default, so these DOM events are the signal the shell uses.
 */
export function useAppResume(onResume: (event: AppResumeEvent) => void) {
  const callbackRef = useRef(onResume);
  useEffect(() => {
    callbackRef.current = onResume;
  });

  useEffect(() => {
    let hiddenAt: number | null =
      document.visibilityState === "hidden" ? Date.now() : null;

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const hiddenMs = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      callbackRef.current({ reason: "visible", hiddenMs });
    };
    const onOnline = () =>
      callbackRef.current({ reason: "online", hiddenMs: 0 });

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
    };
  }, []);
}
