import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { googleConnectionStatus } from "../../lib/api-google";
import { getRepoSetting, setRepoSetting } from "../../lib/api";
import { ensureProxySessionSync } from "../../lib/proxy-session-sync";
import { isProSubscription } from "../../lib/subscription";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/button";
import { GoogleWorkspaceUpsell } from "./GoogleWorkspaceUpsell";
import { Textarea } from "../ui/textarea";
import { errorText } from "../../lib/errorText";
import { functionsErrorText } from "../../lib/functionsErrorText";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

const SettingRow: React.FC<{
  title: string;
  description: string;
  children?: React.ReactNode;
}> = ({ title, description, children }) => (
  <div className="flex items-start justify-between gap-4 py-3">
    <div className="min-w-0">
      <p className="font-medium">{title}</p>
      <p className="text-base text-muted-foreground">{description}</p>
    </div>
    <div className="flex items-center gap-2 shrink-0">{children}</div>
  </div>
);

/** How often, and how long, to wait for the Pro sign-in to land server side. */
export const PRO_POLL_INTERVAL_MS = 3_000;
export const PRO_POLL_TIMEOUT_MS = 120_000;

/**
 * Google Workspace is a Pro feature: treq's OAuth app connects the account and
 * the grant is held server side. Other plans see an upsell.
 */
export const GoogleIntegrationSettings: React.FC<{ repoPath?: string }> = ({
  repoPath,
}) => {
  const { subscription, user } = useAuthStore();
  const isPro = isProSubscription(subscription);
  const { addToast } = useToastStore();
  const [reviewPrompt, setReviewPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitingForPro, setWaitingForPro] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const mounted = useRef(true);
  /** Bumped to stop the running Pro poll (cancel or unmount). */
  const pollRun = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pollRun.current++;
    };
  }, []);

  const {
    data: status,
    error: statusError,
    mutate,
  } = useSWR(
    ["google-connection-status"],
    async () => {
      await ensureProxySessionSync().catch(() => undefined);
      return googleConnectionStatus();
    },
    { revalidateOnFocus: true },
  );

  useEffect(() => {
    if (!repoPath) return;
    void getRepoSetting(repoPath, "google_review_prompt")
      .then((saved) => setReviewPrompt((current) => current || (saved ?? "")))
      .catch(() => undefined);
  }, [repoPath]);

  /** Waits for the browser sign-in to store the grant server side. */
  const waitForProxy = async () => {
    const run = ++pollRun.current;
    const live = () => mounted.current && pollRun.current === run;
    setWaitingForPro(true);
    // Recursive rather than a loop: each step waits on the one before.
    const poll = async (waited: number): Promise<boolean> => {
      if (waited >= PRO_POLL_TIMEOUT_MS) return false;
      await new Promise((r) => setTimeout(r, PRO_POLL_INTERVAL_MS));
      if (!live()) return true;
      const next = await googleConnectionStatus().catch(() => null);
      if (!live()) return true;
      if (next?.mode !== "proxy") return poll(waited + PRO_POLL_INTERVAL_MS);
      await mutate(next, { revalidate: false });
      if (live()) {
        addToast({ title: "Google Workspace connected", type: "success" });
      }
      return true;
    };
    try {
      if (await poll(0)) return;
      addToast({
        title: "Didn't hear back from Google sign-in",
        description:
          "If you finished signing in, check the status again in a moment. Otherwise click Connect with Google to try again.",
        type: "warning",
      });
    } finally {
      if (live()) setWaitingForPro(false);
    }
  };

  const cancelPro = () => {
    pollRun.current++;
    setWaitingForPro(false);
  };

  const connectPro = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-google-oauth-intent",
        { body: {} },
      );
      if (error) throw new Error(await functionsErrorText(error));
      if (!data?.authorize_url)
        throw new Error("No authorization URL returned");
      await openUrl(data.authorize_url);
    } catch (e) {
      addToast({
        title: "Error starting OAuth flow",
        description: errorText(e),
        type: "error",
      });
      return;
    } finally {
      if (mounted.current) setBusy(false);
    }
    if (mounted.current) await waitForProxy();
  };

  // Not Pro-gated: a lapsed plan must still be able to remove its grant.
  const disconnectPro = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "disconnect-google",
        { body: {} },
      );
      if (error) throw new Error(await functionsErrorText(error));
      await mutate();
      addToast({
        title: data?.disconnected
          ? "Google disconnected from your treq account"
          : "No Google account was connected through treq",
        type: "success",
      });
    } catch (e) {
      addToast({
        title: "Failed to disconnect Google",
        description: errorText(e),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const saveReviewPrompt = async () => {
    if (!repoPath) return;
    try {
      await setRepoSetting(repoPath, "google_review_prompt", reviewPrompt);
      addToast({ title: "Review instructions saved", type: "success" });
    } catch (e) {
      addToast({
        title: "Failed to save review instructions",
        description: errorText(e),
        type: "error",
      });
    }
  };

  const confirmDisconnect = () => {
    setConfirming(false);
    void disconnectPro();
  };

  const mode = status?.mode;
  const modeLabel =
    !status && statusError
      ? `Couldn't check the connection: ${errorText(statusError)}`
      : !status
        ? "Checking…"
        : mode === "proxy"
          ? "Connected through treq (Pro)"
          : "Not connected";

  return (
    <section>
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <h3 className="font-semibold">Google Workspace</h3>
        <span className="text-base text-muted-foreground">
          Tasks, Docs and Drive
        </span>
      </div>
      {!isPro ? (
        <div className="py-3 space-y-2">
          <GoogleWorkspaceUpsell />
          {user && (
            <button
              type="button"
              className="text-sm text-muted-foreground underline"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              Remove Google from your treq account
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border">
          <SettingRow title="Status" description={modeLabel}>
            {!status && statusError && (
              <Button size="sm" variant="outline" onClick={() => void mutate()}>
                Retry
              </Button>
            )}
            {mode === "proxy" && user && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirming(true)}
                disabled={busy}
              >
                Disconnect
              </Button>
            )}
          </SettingRow>

          {mode !== "proxy" && (
            <SettingRow
              title="Connect via treq"
              description={
                waitingForPro
                  ? "Waiting for Google sign-in in your browser…"
                  : "Sign in with Google to use Tasks, Docs and Drive in treq."
              }
            >
              <Button
                size="sm"
                variant="outline"
                onClick={connectPro}
                disabled={busy || waitingForPro}
              >
                Connect with Google
              </Button>
              {waitingForPro && (
                <Button size="sm" variant="ghost" onClick={cancelPro}>
                  Cancel
                </Button>
              )}
            </SettingRow>
          )}
          {user && mode !== "proxy" && (
            <div className="pb-3">
              <button
                type="button"
                className="text-sm text-muted-foreground underline"
                onClick={() => setConfirming(true)}
                disabled={busy}
              >
                Remove Google from your treq account
              </button>
            </div>
          )}

          {repoPath && (
            <div className="py-3 space-y-2">
              <p className="font-medium">Document review instructions</p>
              <p className="text-base text-muted-foreground">
                Added to the review agent&apos;s prompt when reviewing Docs and
                Drive files for this repository.
              </p>
              <Textarea
                value={reviewPrompt}
                onChange={(e) => setReviewPrompt(e.target.value)}
                placeholder="e.g. Check that every claim cites a source."
                aria-label="Document review instructions"
              />
              <Button size="sm" onClick={saveReviewPrompt}>
                Save
              </Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => !open && setConfirming(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              treq removes the Google grant it holds for your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisconnect}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
