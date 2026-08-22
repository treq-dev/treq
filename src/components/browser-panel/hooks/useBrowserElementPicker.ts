import { useCallback, useEffect, useRef, useState } from "react";
import {
  listenBrowserElementPicked,
  setBrowserSelectMode,
} from "../../../lib/api";
import type { PickedElement } from "../types";
import { toLocalPickedElement } from "../utils";

export function useBrowserElementPicker(webviewOpen: boolean) {
  const [selectMode, setSelectMode] = useState(false);
  const [pendingPick, setPendingPick] = useState<PickedElement | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    listenBrowserElementPicked((element) => {
      setPendingPick(toLocalPickedElement(element));
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenRef.current = unlisten;
    });
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const toggleSelectMode = useCallback(async () => {
    if (!webviewOpen) return;
    const next = !selectMode;
    setSelectMode(next);
    try {
      await setBrowserSelectMode(next);
    } catch {
      // best-effort: the preview webview may not be ready yet
    }
  }, [selectMode, webviewOpen]);

  const clearPendingPick = useCallback(() => {
    setPendingPick(null);
  }, []);

  return {
    selectMode,
    pendingPick,
    toggleSelectMode,
    clearPendingPick,
  };
}
