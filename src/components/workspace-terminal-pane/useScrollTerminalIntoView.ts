import { type RefObject } from "react";
import { scrollTerminalFullyIntoView } from "./scrollTerminalFullyIntoView";

export function useScrollTerminalIntoView(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
) {
  const scrollToTerminal = (terminalId: string) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current?.querySelector(
          `[data-terminal-id="${CSS.escape(terminalId)}"]`,
        );
        if (el) {
          el.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "nearest",
          });
        }
      });
    });
  };

  const handleTerminalDoubleClick = (terminalId: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector(
      `[data-terminal-id="${CSS.escape(terminalId)}"]`,
    );
    if (el instanceof HTMLElement) {
      scrollTerminalFullyIntoView(container, el);
    }
  };

  return { scrollToTerminal, handleTerminalDoubleClick };
}
