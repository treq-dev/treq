import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  googleConnectionStatus,
  googleDisconnectLocal,
  googleOAuthBegin,
  googleOAuthCancel,
  googleOAuthComplete,
} from "../../lib/api-google";
import { getRepoSetting, getSetting, setRepoSetting } from "../../lib/api";
import { ensureProxySessionSync } from "../../lib/proxy-session-sync";
import { isProSubscription } from "../../lib/subscription";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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

type DisconnectTarget = "local" | "proxy";

/**
 * Free plan: the user's own Google Cloud desktop OAuth client, run through a
 * loopback redirect. Pro plan: treq's OAuth app, held server side.
 */
export const GoogleIntegrationSettings: React.FC<{ repoPath?: string }> = ({
  repoPath,
}) => {
  const { subscription, user } = useAuthStore();
  const isPro = isProSubscription(subscription);
  const { addToast } = useToastStore();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [reviewPrompt, setReviewPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  /** The sign-in page of a pending local connect. */
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const [waitingForPro, setWaitingForPro] = useState(false);
  const [confirming, setConfirming] = useState<DisconnectTarget | null>(null);
  const cancelled = useRef(false);
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

  // Seed the inputs once; never overwrite what the user has typed.
  useEffect(() => {
    void getSetting("google_client_id")
      .then((saved) => setClientId((current) => current || (saved ?? "")))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!repoPath) return;
    void getRepoSetting(repoPath, "google_review_prompt")
      .then((saved) => setReviewPrompt((current) => current || (saved ?? "")))
      .catch(() => undefined);
  }, [repoPath]);

  const connectLocal = async () => {
    setBusy(true);
    cancelled.current = false;
    try {
      const url = await googleOAuthBegin(clientId, clientSecret || undefined);
      setSignInUrl(url);
      await openUrl(url);
      await googleOAuthComplete();
      setClientSecret("");
      await mutate();
      addToast({ title: "Google Workspace connected", type: "success" });
    } catch (e) {
      if (!cancelled.current) {
        addToast({
          title: "Google sign-in failed",
          description: errorText(e),
          type: "error",
        });
      }
    } finally {
      setSignInUrl(null);
      setBusy(false);
    }
  };

  const cancelLocal = async () => {
    cancelled.current = true;
    await googleOAuthCancel().catch(() => undefined);
  };

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
    // The local client takes precedence, so a Pro grant would never show.
    if (status?.mode === "local") return;
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

  const disconnectLocal = async () => {
    setBusy(true);
    try {
      await googleDisconnectLocal();
      await mutate();
      addToast({ title: "Google Workspace disconnected", type: "success" });
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
    const target = confirming;
    setConfirming(null);
    if (target === "local") void disconnectLocal();
    if (target === "proxy") void disconnectPro();
  };

  const mode = status?.mode;
  const modeLabel =
    !status && statusError
      ? `Couldn't check the connection: ${errorText(statusError)}`
      : !status
        ? "Checking…"
        : mode === "local"
          ? "Connected with your own OAuth client"
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
      <div className="divide-y divide-border">
        <SettingRow title="Status" description={modeLabel}>
          {!status && statusError && (
            <Button size="sm" variant="outline" onClick={() => void mutate()}>
              Retry
            </Button>
          )}
          {(mode === "local" || (mode === "proxy" && user)) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirming(mode)}
              disabled={busy}
            >
              Disconnect
            </Button>
          )}
        </SettingRow>

        <div className="py-3 space-y-2">
          <p className="font-medium">Your own OAuth client (free)</p>
          <p className="text-base text-muted-foreground">
            Create a Desktop OAuth client in Google Cloud with the Tasks and
            Drive APIs enabled, then paste its client ID and secret. Tokens stay
            on this device.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-80"
              placeholder="Client ID"
              aria-label="Google OAuth client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={busy}
            />
            <Input
              className="w-64"
              type="password"
              placeholder="Client secret"
              aria-label="Google OAuth client secret"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={busy}
            />
            <Button
              size="sm"
              onClick={connectLocal}
              disabled={busy || !clientId.trim()}
            >
              {busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Connect
            </Button>
          </div>
          {signInUrl && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                Waiting for Google sign-in in your browser…
              </span>
              <button
                type="button"
                className="text-primary underline"
                onClick={() => void openUrl(signInUrl)}
              >
                Reopen sign-in page
              </button>
              <Button size="sm" variant="outline" onClick={cancelLocal}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        <SettingRow
          title="Connect via treq"
          description={
            waitingForPro
              ? "Waiting for Google sign-in in your browser…"
              : mode === "local"
                ? "Your own OAuth client is connected and takes precedence. Disconnect it to connect through treq."
                : isPro
                  ? "Use treq's Google app. No Cloud project needed."
                  : "Pro plan: connect without your own Google Cloud project."
          }
        >
          <Button
            size="sm"
            variant="outline"
            onClick={connectPro}
            disabled={!isPro || busy || waitingForPro || mode === "local"}
          >
            Connect with Google
          </Button>
          {waitingForPro && (
            <Button size="sm" variant="ghost" onClick={cancelPro}>
              Cancel
            </Button>
          )}
        </SettingRow>
        {user && mode !== "proxy" && (
          <div className="pb-3">
            <button
              type="button"
              className="text-sm text-muted-foreground underline"
              onClick={() => setConfirming("proxy")}
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

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "local"
                ? "treq deletes the Google tokens stored on this device."
                : "treq removes the Google grant it holds for your account."}
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
