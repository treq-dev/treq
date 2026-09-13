import * as React from "react";

/**
 * Minimal local replacement for @radix-ui/react-slot's `Slot`.
 *
 * Merges the props passed to `Slot` onto its single child element instead of
 * rendering a wrapper element, so components can offer an `asChild` prop
 * without depending on any UI primitive library.
 */
function mergeRefs<T>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") {
        ref(value);
      } else {
        (ref as React.RefObject<T | null>).current = value;
      }
    }
  };
}

function mergeProps(
  slotProps: Record<string, unknown>,
  childProps: Record<string, unknown>,
) {
  const merged: Record<string, unknown> = { ...slotProps, ...childProps };

  for (const key in childProps) {
    const slotValue = slotProps[key];
    const childValue = childProps[key];
    const isHandler = /^on[A-Z]/.test(key);

    if (isHandler) {
      if (slotValue && childValue) {
        merged[key] = (...args: unknown[]) => {
          (childValue as (...a: unknown[]) => void)(...args);
          (slotValue as (...a: unknown[]) => void)(...args);
        };
      } else if (slotValue) {
        merged[key] = slotValue;
      }
    } else if (key === "className" || key === "style") {
      merged[key] =
        key === "className"
          ? [slotValue, childValue].filter(Boolean).join(" ")
          : { ...(slotValue as object), ...(childValue as object) };
    }
  }

  return merged;
}

export interface SlotProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
  ref?: React.Ref<HTMLElement>;
}

export function Slot({ children, ref, ...slotProps }: SlotProps) {
  if (React.isValidElement(children)) {
    const childElement = children as React.ReactElement<
      Record<string, unknown> & { ref?: React.Ref<HTMLElement> }
    >;
    return React.cloneElement(childElement, {
      ...mergeProps(
        slotProps as Record<string, unknown>,
        (childElement.props ?? {}) as Record<string, unknown>,
      ),
      ref: mergeRefs(ref, childElement.props.ref),
    });
  }

  if (React.Children.count(children) > 1) {
    React.Children.only(null);
  }

  return null;
}
Slot.displayName = "Slot";
