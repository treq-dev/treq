import { useState } from "react";
import type { MutationDispatchResult } from "../../lib/remote-dispatch";

export function RefreshButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-end rounded-md border px-2 py-1 text-xs"
    >
      {loading ? "Refreshing..." : "Refresh"}
    </button>
  );
}

/**
 * Phase 5 (controlled mutations): arm/confirm button wired to
 * `dispatchMutationOverSsh`. First press arms and shows a "Confirm" label;
 * a second press within the armed state actually dispatches, since Phase 5
 * requires explicit confirmation before any mutation goes out.
 */
export function MutationButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  variant,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  variant?: "destructive";
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
      onBlur={() => setArmed(false)}
      className={`rounded-md border px-3 py-2 text-sm ${
        variant === "destructive" ? "text-destructive" : ""
      }`}
    >
      {busy ? "Working..." : armed ? confirmLabel : label}
    </button>
  );
}

/** Renders the non-"applied" outcomes of a mutation dispatch as an error. */
export function describeMutationOutcome<T>(
  result: MutationDispatchResult<T>,
): string | null {
  if (result.status === "ambiguous") {
    return `Could not confirm the change applied: ${result.reason}`;
  }
  return null;
}
