import { useEffect, useState } from "react";
export function useTerminalPaneHeightResize(maximized: boolean) {
  const [height, setHeight] = useState(33);
  const [isResizingHeight, setIsResizingHeight] = useState(false);

  const handleHeightResizeMouseDown = (e: React.MouseEvent) => {
    if (maximized) return;
    e.preventDefault();
    setIsResizingHeight(true);
  };

  useEffect(() => {
    if (!isResizingHeight) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = document.querySelector(".workspace-terminal-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const distanceFromBottom = rect.bottom - e.clientY;
      const newHeightPercent = (distanceFromBottom / rect.height) * 100;
      setHeight(Math.max(15, Math.min(60, newHeightPercent)));
    };

    const handleMouseUp = () => setIsResizingHeight(false);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingHeight]);

  useEffect(() => {
    if (isResizingHeight) {
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    } else {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  }, [isResizingHeight]);

  return {
    height,
    isResizingHeight,
    handleHeightResizeMouseDown,
  };
}
