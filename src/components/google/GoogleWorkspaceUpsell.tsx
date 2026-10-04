import { openUrl } from "@tauri-apps/plugin-opener";
import { Rocket } from "lucide-react";
import { WEB_URL } from "../../lib/supabase";
import { Button } from "../ui/button";

/** Shown in place of Google Workspace features on non-Pro plans. */
export function GoogleWorkspaceUpsell() {
  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="max-w-md w-full rounded-xl border border-border bg-gradient-to-br from-muted/40 via-background to-green-500/5 p-8 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
          <Rocket className="w-6 h-6" />
        </div>
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-base font-semibold tracking-wide px-1.5 py-0.5 rounded bg-green-500/20 text-green-700 dark:text-green-400">
            PRO
          </div>
          <h2 className="text-lg font-semibold tracking-tight">
            Unlock Google Workspace
          </h2>
          <p className="text-base text-muted-foreground leading-relaxed">
            Plan work on a Google Tasks board, start workspaces from tasks, and
            have an agent review your Docs. Upgrade to Pro to connect Google
            Workspace to Treq.
          </p>
        </div>
        <Button
          size="lg"
          className="gap-2 w-full bg-green-600 hover:bg-green-700 text-white"
          onClick={() => openUrl(`${WEB_URL}/dashboard`)}
        >
          <Rocket className="w-4 h-4" />
          Upgrade to Pro
        </Button>
      </div>
    </div>
  );
}
