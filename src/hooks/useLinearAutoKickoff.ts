import { useEffect } from "react";
import { linearStartAutoKickoffPolling } from "../lib/api-linear";

/**
 * Registers the open repo with the backend auto-kickoff poller. The poller
 * no-ops for repos without a kickoff label, so registering every opened repo
 * is cheap and keeps kickoffs running after an app restart.
 */
export function useLinearAutoKickoff(repoPath: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !repoPath) return;
    linearStartAutoKickoffPolling(repoPath).catch((err) => {
      console.warn("Failed to start Linear auto-kickoff polling", err);
    });
  }, [repoPath, enabled]);
}
