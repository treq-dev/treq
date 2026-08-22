import { useEffect, useRef } from "react";
type KeyboardHandler = (event: KeyboardEvent) => void;

function isWithinTerminal(element: HTMLElement | null): boolean {
  if (!element) return false;
  // Check for terminal containers.
  return element.closest(".xterm, [data-terminal]") !== null;
}

export function useKeyboardShortcut(
  key: string,
  ctrlOrCmd: boolean,
  handler: () => void,
  deps: unknown[] = [],
  options?: {
    shift?: boolean;
    /** Skip shiftKey require/reject checks (needed for "?" across browsers/tests). */
    ignoreShift?: boolean;
    option?: boolean;
    requireBothCmdAndCtrl?: boolean;
  },
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const handleKeyPress: KeyboardHandler = (event) => {
      const target = event.target as HTMLElement | null;
      const activeElement = document.activeElement as HTMLElement | null;

      // Don't intercept plain-key shortcuts in inputs; meta shortcuts (Ctrl/Cmd+X) still apply.
      if (
        !ctrlOrCmd &&
        (target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          (target &&
            typeof (target as HTMLElement).getAttribute === "function" &&
            (target as HTMLElement).getAttribute("contenteditable") === "true"))
      ) {
        return;
      }

      // Allow specific global shortcuts to work even when terminal is focused
      const allowInTerminal = ["k", "j", "n", "p", "Escape", "]", "\\", "w"];
      const shouldAllow =
        (ctrlOrCmd && allowInTerminal.includes(key)) ||
        (!ctrlOrCmd && key === "Escape");

      if (
        !shouldAllow &&
        (isWithinTerminal(target) || isWithinTerminal(activeElement))
      ) {
        return;
      }

      const isModifierPressed = event.ctrlKey || event.metaKey;
      const shiftRequired = options?.shift ?? false;
      const ignoreShift = options?.ignoreShift ?? false;
      const optionRequired = options?.option ?? false;
      const requireBothCmdAndCtrl = options?.requireBothCmdAndCtrl ?? false;

      if (event.key.toLowerCase() === key.toLowerCase()) {
        // Special case: require both Cmd/Meta AND Ctrl
        if (requireBothCmdAndCtrl) {
          if (!event.metaKey || !event.ctrlKey) return;
          // When requireBothCmdAndCtrl, also check shift and alt are not pressed unless required
          if (!ignoreShift) {
            if (!shiftRequired && event.shiftKey) return;
            if (shiftRequired && !event.shiftKey) return;
          }
          if (!optionRequired && event.altKey) return;
        } else {
          if (ctrlOrCmd && !isModifierPressed) return;
          if (!ctrlOrCmd && isModifierPressed) return;

          // Reject both Cmd+Ctrl when only one modifier is required (avoid Cmd+J on Cmd+Ctrl+J).
          if (ctrlOrCmd && event.metaKey && event.ctrlKey) return;

          // Check shift key requirements
          if (!ignoreShift) {
            if (shiftRequired && !event.shiftKey) return;
            if (!shiftRequired && event.shiftKey) return;
          }
          // Check option/alt key requirements
          if (optionRequired && !event.altKey) return;
          if (!optionRequired && event.altKey) return;
        }

        event.preventDefault();
        handlerRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [
    key,
    ctrlOrCmd,
    options?.shift,
    options?.ignoreShift,
    options?.option,
    options?.requireBothCmdAndCtrl,
    ...deps,
  ]);
}
