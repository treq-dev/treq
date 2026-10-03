import { useEffect } from "react";
import { linearStartAutoKickoffPolling } from "../lib/api-linear";
import { ensureProxySessionSync } from "../lib/proxy-session-sync";

/**
 * Registers the open repo with the backend auto-kickoff poller. The poller
 * no-ops for repos without a kickoff label, so registering every opened repo
 * is cheap and keeps kickoffs running after an app restart.
 *
 * The Supabase session is pushed first so an OAuth-connected repo's first
 * poll can already reach the Linear proxy.
 */
export function useLinearAutoKickoff(repoPath: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !repoPath) return;
    void ensureProxySessionSync()
      .then(() => linearStartAutoKickoffPolling(repoPath))
      .catch((err) => {
        console.warn("Failed to start Linear auto-kickoff polling", err);
      });
  }, [repoPath, enabled]);
}
