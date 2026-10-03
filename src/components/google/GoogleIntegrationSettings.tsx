import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import {
  googleConnectionStatus,
  googleDisconnectLocal,
  googleOAuthBegin,
  googleOAuthComplete,
} from "../../lib/api-google";
import { getRepoSetting, getSetting, setRepoSetting } from "../../lib/api";
import { ensureGoogleProxySessionSync } from "../../lib/google-proxy-auth";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Free plan: the user's own Google Cloud desktop OAuth client, run through a
 * loopback redirect. Pro plan: treq's OAuth app, held server side.
 */
export const GoogleIntegrationSettings: React.FC<{ repoPath?: string }> = ({
  repoPath,
}) => {
  const { subscription } = useAuthStore();
  const isPro =
    subscription?.plan === "pro" && subscription.status === "active";
  const { addToast } = useToastStore();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [reviewPrompt, setReviewPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: status, mutate } = useSWR(
    ["google-connection-status"],
    async () => {
      await ensureGoogleProxySessionSync().catch(() => undefined);
      return googleConnectionStatus();
    },
    { revalidateOnFocus: true },
  );
  useSWR(
    ["google-client-id"],
    async () => setClientId((await getSetting("google_client_id")) ?? ""),
    { revalidateOnFocus: false, dedupingInterval: 0 },
  );
  useSWR(
    repoPath ? ["google-review-prompt", repoPath] : null,
    async () =>
      setReviewPrompt(
        (await getRepoSetting(repoPath!, "google_review_prompt")) ?? "",
      ),
    { revalidateOnFocus: false, dedupingInterval: 0 },
  );

  const connectLocal = async () => {
    setBusy(true);
    try {
      const url = await googleOAuthBegin(clientId, clientSecret || undefined);
      await openUrl(url);
      await googleOAuthComplete();
      setClientSecret("");
      await mutate();
      addToast({ title: "Google Workspace connected", type: "success" });
    } catch (e) {
      addToast({
        title: "Google sign-in failed",
        description: errorText(e),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const connectPro = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-google-oauth-intent",
        { body: {} },
      );
      if (error) throw new Error(errorText(error));
      if (!data?.authorize_url)
        throw new Error("No authorization URL returned");
      await openUrl(data.authorize_url);
    } catch (e) {
      addToast({
        title: "Error starting OAuth flow",
        description: errorText(e),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const disconnectLocal = async () => {
    await googleDisconnectLocal();
    await mutate();
  };

  const saveReviewPrompt = async () => {
    if (!repoPath) return;
    await setRepoSetting(repoPath, "google_review_prompt", reviewPrompt);
    addToast({ title: "Review instructions saved", type: "success" });
  };

  const modeLabel =
    status?.mode === "local"
      ? "Connected with your own OAuth client"
      : status?.mode === "proxy"
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
          {status?.mode === "local" && (
            <Button size="sm" variant="outline" onClick={disconnectLocal}>
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
        </div>

        <SettingRow
          title="Connect via treq"
          description={
            isPro
              ? "Use treq's Google app. No Cloud project needed."
              : "Pro plan: connect without your own Google Cloud project."
          }
        >
          <Button
            size="sm"
            variant="outline"
            onClick={connectPro}
            disabled={!isPro || busy}
          >
            Connect with Google
          </Button>
        </SettingRow>

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
    </section>
  );
};
