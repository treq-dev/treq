import { type RefObject, useEffect, useState } from "react";
function getResizeEntryWidth(entry: ResizeObserverEntry): number {
  const sizeFrom = (
    size: ResizeObserverSize | ReadonlyArray<ResizeObserverSize> | undefined,
  ): number | undefined => {
    if (!size) return undefined;
    if ("inlineSize" in size) return size.inlineSize;
    return size[0]?.inlineSize;
  };

  return (
    entry.contentRect?.width ??
    sizeFrom(entry.contentBoxSize) ??
    sizeFrom(entry.borderBoxSize) ??
    (entry.target as Element).clientWidth
  );
}

export function useScrollContainerWidth(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  collapsed: boolean,
): number {
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    setContainerWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(getResizeEntryWidth(entry));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [collapsed, scrollContainerRef]);

  return containerWidth;
}
