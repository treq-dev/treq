import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/utils";
import {
  DEFAULT_SIDEBAR_WIDTH,
  useSidebarWidthStore,
} from "../stores/sidebarWidthStore";

export function WorkspaceSidebarResizeHandle() {
  const [isDragging, setIsDragging] = useState(false);
  const lastXRef = useRef(0);

  const handleMouseDown = (event: ReactMouseEvent) => {
    event.preventDefault();
    setIsDragging(true);
    lastXRef.current = event.clientX;
  };

  const handleDoubleClick = () => {
    useSidebarWidthStore.getState().setWidth(DEFAULT_SIDEBAR_WIDTH);
    void useSidebarWidthStore.getState().persistWidth();
  };

  useEffect(() => {
    if (!isDragging) return;

    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - lastXRef.current;
      lastXRef.current = event.clientX;
      useSidebarWidthStore
        .getState()
        .setWidth(useSidebarWidthStore.getState().width + deltaX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      void useSidebarWidthStore.getState().persistWidth();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  return (
    <button
      type="button"
      aria-label="Resize workspace sidebar"
      title="Drag to resize"
      className="absolute inset-y-0 right-0 z-20 w-1 cursor-ew-resize border-0 bg-transparent p-0"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className={cn(
          "absolute inset-y-0 right-0 w-px bg-transparent transition-colors",
          "hover:bg-primary/50",
          isDragging && "bg-primary",
        )}
      />
      <div className="absolute inset-y-0 -right-1 w-3 cursor-ew-resize" />
    </button>
  );
}
