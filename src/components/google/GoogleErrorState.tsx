import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { errorText } from "../../lib/errorText";
import { Button } from "../ui/button";

/** True when a Google error means the grant is gone and the user must sign in again. */
export function needsGoogleReconnect(message: string): boolean {
  return /reconnect|sign[ -]?in|authori[sz]ation|expired|not connected/i.test(
    message,
  );
}

/**
 * A failed Google load: the error, a Retry button and, when the grant is
 * gone, a way to Settings to reconnect.
 */
export const GoogleErrorState: React.FC<{
  error: unknown;
  onRetry: () => void;
  onOpenSettings?: () => void;
  className?: string;
}> = ({ error, onRetry, onOpenSettings, className }) => {
  const { mutate } = useSWRConfig();
  const message = errorText(error);
  const reconnect = needsGoogleReconnect(message);
  useEffect(() => {
    // The panel may still think Google is connected; recheck.
    if (reconnect) void mutate(["google-connection-status"]);
  }, [reconnect, mutate]);
  return (
    <div className={className ?? "p-6 space-y-2"} role="alert">
      <p className="text-sm text-destructive">{message}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
        {reconnect && onOpenSettings && (
          <Button size="sm" onClick={onOpenSettings}>
            Reconnect in Settings
          </Button>
        )}
      </div>
    </div>
  );
};
