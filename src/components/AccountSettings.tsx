import {
  CreditCard,
  Crown,
  ExternalLink,
  Loader2,
  LogOut,
  Server,
  User,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { WEB_URL } from "../lib/supabase";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuthStore } from "../stores/authStore";
import { useState } from "react";

const isDev = import.meta.env.DEV;

interface AccountSettingsProps {
  onOpenRemoteSetup?: () => void;
}

export const AccountSettings: React.FC<AccountSettingsProps> = ({
  onOpenRemoteSetup,
}) => {
  const { user, loading, subscription, signIn, signOut, exchangeToken } =
    useAuthStore();
  const [callbackUrl, setCallbackUrl] = useState("");
  const [devError, setDevError] = useState<string | null>(null);
  const [devLoading, setDevLoading] = useState(false);

  const handleDevCallback = async () => {
    setDevError(null);
    setDevLoading(true);
    try {
      // Accept either a full treq://auth/callback?token=XXX URL or just the token
      let token = callbackUrl.trim();
      if (token.includes("token=")) {
        const url = new URL(token);
        token = url.searchParams.get("token") || "";
      }
      if (!token) {
        setDevError("No token found in URL");
        return;
      }
      await exchangeToken(token);
      setCallbackUrl("");
    } catch (err: unknown) {
      setDevError(err instanceof Error ? err.message : "Token exchange failed");
    } finally {
      setDevLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <User className="w-8 h-8 text-muted-foreground" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold">Sign in to Treq</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Sync your settings and manage your subscription
          </p>
        </div>
        <Button onClick={signIn} className="gap-2">
          <ExternalLink className="w-4 h-4" />
          Sign in with Browser
        </Button>

        {isDev && (
          <div className="w-full max-w-sm mt-4 p-3 border border-dashed border-yellow-500/50 rounded-lg bg-yellow-500/5">
            <div className="text-xs font-medium text-yellow-600 dark:text-yellow-400 mb-2">
              Dev: Paste callback URL
            </div>
            <div className="flex gap-2">
              <Input
                value={callbackUrl}
                onChange={(event) => setCallbackUrl(event.target.value)}
                placeholder="treq://auth/callback?token=..."
                className="text-xs font-mono"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleDevCallback}
                disabled={devLoading || !callbackUrl.trim()}
              >
                {devLoading ? "..." : "Go"}
              </Button>
            </div>
            {devError && (
              <p className="text-xs text-red-500 mt-1">{devError}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  const avatarUrl =
    user.user_metadata?.avatar_url || user.user_metadata?.picture;
  const fullName =
    user.user_metadata?.full_name || user.user_metadata?.name || "User";
  const { email } = user;

  const isPro =
    subscription?.plan === "pro" && subscription?.status === "active";

  return (
    <div className="space-y-6">
      {/* User Info Card */}
      <div className="border border-border rounded-lg p-4">
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={fullName}
              className="w-12 h-12 rounded-full"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <User className="w-6 h-6 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{fullName}</div>
            <div className="text-sm text-muted-foreground truncate">
              {email}
            </div>
          </div>
        </div>
      </div>

      {/* Subscription Card */}
      <div className="border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="w-4 h-4" />
          <span className="font-medium">Subscription</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Plan</span>
            <span className="text-sm font-medium flex items-center gap-1">
              {isPro && <Crown className="w-3 h-3 text-yellow-500" />}
              {isPro ? "Pro" : "Free"}
            </span>
          </div>
          {subscription?.status && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <span
                className={`text-sm font-medium ${
                  subscription.status === "active"
                    ? "text-green-600 dark:text-green-400"
                    : subscription.status === "canceled"
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-muted-foreground"
                }`}
              >
                {subscription.status.charAt(0).toUpperCase() +
                  subscription.status.slice(1).replace("_", " ")}
              </span>
            </div>
          )}
          {subscription?.current_period_end && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Period ends</span>
              <span className="text-sm">
                {new Date(subscription.current_period_end).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => openUrl(`${WEB_URL}/dashboard`)}
          >
            <ExternalLink className="w-3 h-3" />
            {isPro ? "Manage Subscription" : "Upgrade to Pro"}
          </Button>
        </div>
      </div>

      {onOpenRemoteSetup && (
        <div className="border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Server className="w-4 h-4" />
            <span className="font-medium">Remote control</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Create or manage the persistent Sprite used for remote development.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onOpenRemoteSetup}
          >
            Manage remote environment
          </Button>
        </div>
      )}

      {/* Sign Out */}
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-destructive hover:text-destructive"
        onClick={signOut}
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </Button>
    </div>
  );
};
