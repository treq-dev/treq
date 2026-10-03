import { FileText, ListChecks, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { googleConnectionStatus } from "../../lib/api-google";
import { ensureProxySessionSync } from "../../lib/proxy-session-sync";
import { Button } from "../ui/button";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { GoogleErrorState } from "./GoogleErrorState";
import { type DocReviewLaunch, GoogleDrivePanel } from "./GoogleDrivePanel";
import { GoogleTasksBoard } from "./GoogleTasksBoard";

type GoogleTab = "tasks" | "drive";

export const GoogleWorkspacePanel: React.FC<{
  repoPath: string;
  onStartDocReview: (launch: DocReviewLaunch) => void | Promise<void>;
  onKickoffTask: (prompt: string) => void;
  /** Opens Settings on the Integrations tab. */
  onOpenSettings?: () => void;
}> = ({ repoPath, onStartDocReview, onKickoffTask, onOpenSettings }) => {
  const [tab, setTab] = useState<GoogleTab>("tasks");
  const [proxyReady, setProxyReady] = useState(false);
  useEffect(() => {
    void ensureProxySessionSync()
      .catch(() => undefined)
      .finally(() => setProxyReady(true));
  }, []);
  const {
    data: status,
    error,
    mutate,
  } = useSWR(
    proxyReady ? ["google-connection-status"] : null,
    googleConnectionStatus,
    { revalidateOnFocus: true, shouldRetryOnError: false },
  );

  return (
    <div
      className="flex h-full flex-col bg-background"
      data-testid="google-panel"
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
        <h1 className="text-base font-semibold leading-tight">
          Google Workspace
        </h1>
        <Tabs value={tab} onValueChange={(v) => setTab(v as GoogleTab)}>
          <TabsList>
            <TabsTrigger value="tasks">
              <span className="flex items-center gap-1.5 text-sm">
                <ListChecks className="w-4 h-4" /> Tasks
              </span>
            </TabsTrigger>
            <TabsTrigger value="drive">
              <span className="flex items-center gap-1.5 text-sm">
                <FileText className="w-4 h-4" /> Docs &amp; Drive
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 min-h-0">
        {error && !status ? (
          <GoogleErrorState error={error} onRetry={() => void mutate()} />
        ) : !status ? (
          <Loader2 className="w-4 h-4 m-6 animate-spin text-muted-foreground" />
        ) : status.mode === "none" ? (
          <div className="px-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              Google Workspace is not connected. Connect it in Settings &gt;
              Integrations.
            </p>
            {onOpenSettings && (
              <Button size="sm" onClick={onOpenSettings}>
                Open Settings
              </Button>
            )}
          </div>
        ) : tab === "tasks" ? (
          <GoogleTasksBoard
            repoPath={repoPath}
            onKickoff={onKickoffTask}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <GoogleDrivePanel
            repoPath={repoPath}
            onStartReview={onStartDocReview}
            onOpenSettings={onOpenSettings}
          />
        )}
      </div>
    </div>
  );
};
