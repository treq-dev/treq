import { useEffect } from "react";
import {
  type TrackerProvider,
  trackerStartAutoKickoffPolling,
} from "../lib/api-tracker";

/**
 * Registers the open repo with a tracker's backend auto-kickoff poller. The
 * poller no-ops for repos without credentials or a kickoff label, so every
 * opened repo is registered.
 */
export function useTrackerAutoKickoff(
  provider: TrackerProvider,
  repoPath: string,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || !repoPath) return;
    trackerStartAutoKickoffPolling(provider, repoPath).catch((err) => {
      console.warn(`Failed to start ${provider} auto-kickoff polling`, err);
    });
  }, [provider, repoPath, enabled]);
}
