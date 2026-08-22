import { useEffect, useRef } from "react";
const DEFAULT_THRESHOLD_PX = 80;
const REQUIRED_FINGERS = 2;

export interface UseTwoFingerSwipeOptions {
  onSwipeUp: () => void;
  onSwipeDown: () => void;
  enabled?: boolean;
  thresholdPx?: number;
}

function averageClientY(touches: TouchList | Touch[]): number {
  const list = Array.from(touches as ArrayLike<Touch>);
  if (list.length === 0) return 0;
  return list.reduce((sum, t) => sum + t.clientY, 0) / list.length;
}

/**
 * Detects two-finger vertical swipes on the window.
 * Swipe up / swipe down invoke the corresponding callbacks once per gesture.
 * Uses two fingers to avoid conflicting with macOS Mission Control (three-finger).
 */
export function useTwoFingerSwipe({
  onSwipeUp,
  onSwipeDown,
  enabled = true,
  thresholdPx = DEFAULT_THRESHOLD_PX,
}: UseTwoFingerSwipeOptions) {
  const onSwipeUpRef = useRef(onSwipeUp);
  const onSwipeDownRef = useRef(onSwipeDown);
  onSwipeUpRef.current = onSwipeUp;
  onSwipeDownRef.current = onSwipeDown;

  useEffect(() => {
    if (!enabled) return;

    let active = false;
    let startY = 0;
    let lastY = 0;
    let fired = false;

    const reset = () => {
      active = false;
      startY = 0;
      lastY = 0;
      fired = false;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== REQUIRED_FINGERS) {
        reset();
        return;
      }
      active = true;
      fired = false;
      startY = averageClientY(event.touches);
      lastY = startY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!active) return;
      if (event.touches.length !== REQUIRED_FINGERS) {
        reset();
        return;
      }
      lastY = averageClientY(event.touches);
      if (fired) return;

      const deltaY = lastY - startY;
      if (Math.abs(deltaY) < thresholdPx) return;

      fired = true;
      // Negative delta = fingers moved up = swipe up
      if (deltaY < 0) {
        onSwipeUpRef.current();
      } else {
        onSwipeDownRef.current();
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!active) return;
      if (event.touches.length === 0) {
        reset();
      } else if (event.touches.length !== REQUIRED_FINGERS) {
        reset();
      }
    };

    const onTouchCancel = () => {
      reset();
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [enabled, thresholdPx]);
}
