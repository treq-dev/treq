import { GitBranch, Home, Loader2, Moon, Terminal, X } from "lucide-react";

import type { Workspace } from "../lib/api";
import { cn } from "../lib/utils";
import type { WorkspaceDiffStats } from "../lib/workspace-stack";
import { agentIconComponent } from "./icons/AgentIcons";
import { buildMissionControlGroups } from "./terminal-mission-control/buildMissionControlGroups";
import { useMissionControlDiffStats } from "./terminal-mission-control/useMissionControlDiffStats";
import {
  isTerminalSessionIdle,
  type TerminalSessionSummary,
} from "./terminal/types";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { WorkspaceLocIndicator } from "./WorkspaceLocIndicator";

interface TerminalMissionControlProps {
  open: boolean;
  sessions: TerminalSessionSummary[];
  onClose: () => void;
  onFocus: (id: string) => void;
  repoPath?: string;
  workspaces?: Workspace[];
  /** Optional override for tests; when omitted, stats are fetched from commits. */
  diffStatsByWorkspaceKey?: Map<string, WorkspaceDiffStats>;
}

function getSessionIcon(session: TerminalSessionSummary) {
  if (session.kind === "shell") return Terminal;
  return agentIconComponent(session.agent);
}

type SessionStatus = "streaming" | "idle" | "active";

function sessionStatus(
  session: TerminalSessionSummary,
  now: number,
): SessionStatus {
  if (session.isStreaming) return "streaming";
  if (isTerminalSessionIdle(session, now)) return "idle";
  return "active";
}

function SessionStatusIcon({ status }: { status: SessionStatus }) {
  if (status === "streaming") {
    return (
      <Loader2
        className="h-3 w-3 animate-spin text-primary"
        aria-label="Streaming"
      />
    );
  }
  if (status === "idle") {
    return <Moon className="h-3 w-3 text-muted-foreground" aria-label="Idle" />;
  }
  return (
    <span
      className="inline-block h-2 w-2 rounded-full bg-emerald-500"
      aria-label="Active"
    />
  );
}

export const TerminalMissionControl: React.FC<TerminalMissionControlProps> = ({
  open,
  sessions,
  onClose,
  onFocus,
  repoPath,
  workspaces,
  diffStatsByWorkspaceKey: diffStatsOverride,
}) => {
  const groups = buildMissionControlGroups(sessions);
  const fetched = useMissionControlDiffStats({
    open,
    repoPath,
    workspaces,
    groups,
  });
  const diffStatsByWorkspaceKey =
    diffStatsOverride ?? fetched.diffStatsByWorkspaceKey;
  const maxChange = diffStatsOverride
    ? Math.max(
        0,
        ...Array.from(diffStatsOverride.values()).map((stats) =>
          Math.max(stats.insertions, stats.deletions),
        ),
      )
    : fetched.maxChange;
  const now = Date.now();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      data-testid="terminal-mission-control"
      role="dialog"
      aria-modal="true"
      aria-label="Terminal Mission Control"
    >
      <button
        type="button"
        aria-label="Close Mission Control backdrop"
        data-testid="mission-control-backdrop"
        className="absolute inset-0 bg-background/50 backdrop-blur-md transition-opacity animate-in fade-in-0"
        onClick={onClose}
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col animate-in fade-in-0 slide-in-from-bottom-4 duration-200">
        <div className="flex shrink-0 justify-end px-8 pt-6 pb-2">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Close Mission Control"
            data-testid="mission-control-close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16">
          <div className="mx-auto max-w-5xl space-y-8">
            {groups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-card/40 px-6 py-16 text-center text-sm text-muted-foreground">
                No open terminals
              </div>
            ) : (
              groups.map((group) => {
                const loc = diffStatsByWorkspaceKey.get(group.workspaceKey);
                return (
                  <section
                    key={group.workspaceKey}
                    data-testid={`mission-control-group-${group.workspaceKey}`}
                    className="space-y-3"
                  >
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {group.isMainRepo ? (
                        <Home className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <GitBranch className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <h3 className="min-w-0 truncate text-sm font-mono text-foreground">
                        {group.workspaceName}
                      </h3>
                      {loc ? (
                        <WorkspaceLocIndicator
                          className="ml-auto shrink-0"
                          diffStats={loc}
                          maxChange={maxChange}
                        />
                      ) : null}
                    </div>

                    <div
                      data-testid={`mission-control-grid-${group.workspaceKey}`}
                      className="grid grid-cols-2 gap-3"
                    >
                      {group.terminals.map((session) => {
                        const Icon = getSessionIcon(session);
                        const status = sessionStatus(session, now);
                        return (
                          <Card
                            key={session.id}
                            role="button"
                            tabIndex={0}
                            data-testid={`mission-control-card-${session.id}`}
                            className={cn(
                              "cursor-pointer overflow-hidden border-border/60 bg-card/90 shadow-sm",
                              "transition-transform duration-150 hover:-translate-y-0.5 hover:border-border hover:shadow-md",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            )}
                            onClick={() => {
                              onFocus(session.id);
                              onClose();
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onFocus(session.id);
                                onClose();
                              }
                            }}
                          >
                            <CardHeader className="flex flex-row items-center gap-2 space-y-0 border-b border-border/40 bg-muted/40 px-4 py-2.5">
                              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <CardTitle className="min-w-0 flex-1 truncate text-sm font-medium">
                                {session.name}
                              </CardTitle>
                              <SessionStatusIcon status={status} />
                            </CardHeader>
                            <CardContent className="p-0">
                              <div
                                data-testid={`mission-control-preview-${session.id}`}
                                className={cn(
                                  "h-28 overflow-hidden px-3 py-2",
                                  "bg-[#0c0c0c] text-zinc-300",
                                  "flex flex-col justify-end",
                                )}
                              >
                                {session.previewOutput ? (
                                  <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                                    {session.previewOutput}
                                  </pre>
                                ) : (
                                  <span className="font-mono text-[11px] text-zinc-500">
                                    No output yet
                                  </span>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </div>

        <p
          data-testid="mission-control-swipe-hint"
          className="pointer-events-none absolute inset-x-0 bottom-4 z-10 text-center text-sm text-muted-foreground"
        >
          Swipe down with two fingers to close
        </p>
      </div>
    </div>
  );
};
