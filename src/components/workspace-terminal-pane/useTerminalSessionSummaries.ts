import { useEffect, useRef, useState } from "react";
import { formatTerminalPreview } from "../terminal-mission-control/formatTerminalPreview";
import { type TerminalSessionSummary } from "../terminal/types";
import { type TerminalEntry } from "./types";

interface UseTerminalSessionSummariesOptions {
  allTerminals: TerminalEntry[];
  workspaceBranchByPath?: Map<string, string>;
  currentBranch?: string | null;
  onTerminalsChange?: (summaries: TerminalSessionSummary[]) => void;
}

type TerminalActivity = {
  lastActivityAt: number;
  lastUserInputAt: number;
  isStreaming: boolean;
  previewOutput: string;
};

function getTerminalSummaryId(t: TerminalEntry) {
  return t.type === "shell" ? t.data.id : `claude-${t.data.sessionId}`;
}

/**
 * Tracks last-activity timestamp + streaming state per terminal, and derives
 * the unified `TerminalSessionSummary` list consumed by the sidebar's
 * terminal sessions list (ordering, idle icon, spinner).
 */
export function useTerminalSessionSummaries({
  allTerminals,
  workspaceBranchByPath,
  currentBranch,
  onTerminalsChange,
}: UseTerminalSessionSummariesOptions) {
  const [activity, setActivity] = useState<Map<string, TerminalActivity>>(
    new Map(),
  );

  // Seed a fresh activity entry for every newly-mounted terminal, and prune
  // entries for terminals that have been closed. Single source of truth so
  // every creation path (shell add, agent mount, etc.) is covered uniformly.
  useEffect(() => {
    const liveIds = new Set(allTerminals.map(getTerminalSummaryId));
    setActivity((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of liveIds) {
        if (!next.has(id)) {
          next.set(id, {
            lastActivityAt: Date.now(),
            lastUserInputAt: 0,
            isStreaming: false,
            previewOutput: "",
          });
          changed = true;
        }
      }
      for (const id of next.keys()) {
        if (!liveIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allTerminals]);

  const handleTerminalOutput = (
    id: string,
    output?: string,
    fromProcess = true,
  ) => {
    const previewOutput =
      output === undefined ? undefined : formatTerminalPreview(output);
    setActivity((prev) => {
      const existing = prev.get(id);
      const nextPreview = previewOutput ?? existing?.previewOutput ?? "";
      const lastActivityAt = fromProcess
        ? Date.now()
        : (existing?.lastActivityAt ?? Date.now());
      const isStreaming = fromProcess ? true : (existing?.isStreaming ?? false);
      const lastUserInputAt = existing?.lastUserInputAt ?? 0;
      if (
        existing &&
        existing.lastActivityAt === lastActivityAt &&
        existing.isStreaming === isStreaming &&
        existing.previewOutput === nextPreview
      ) {
        return prev;
      }

      const next = new Map(prev);
      next.set(id, {
        lastActivityAt,
        lastUserInputAt,
        isStreaming,
        previewOutput: nextPreview,
      });
      return next;
    });
  };

  const handleTerminalInput = (id: string) => {
    setActivity((prev) => {
      const existing = prev.get(id);
      const next = new Map(prev);
      next.set(id, {
        lastActivityAt: existing?.lastActivityAt ?? Date.now(),
        lastUserInputAt: Date.now(),
        isStreaming: existing?.isStreaming ?? false,
        previewOutput: existing?.previewOutput ?? "",
      });
      return next;
    });
  };

  const handleTerminalIdlePulse = (id: string) => {
    setActivity((prev) => {
      const existing = prev.get(id);
      if (!existing || !existing.isStreaming) return prev;
      const next = new Map(prev);
      next.set(id, { ...existing, isStreaming: false });
      return next;
    });
  };

  const terminalSummaries: TerminalSessionSummary[] = allTerminals.map((t) => {
    const id = getTerminalSummaryId(t);
    const act = activity.get(id) ?? {
      lastActivityAt: 0,
      lastUserInputAt: 0,
      isStreaming: false,
      previewOutput: "",
    };
    if (t.type === "claude") {
      return {
        id,
        kind: "agent" as const,
        name: t.data.sessionName,
        branchName: t.data.workspaceName ?? null,
        isMainRepo: !t.data.workspaceName,
        agent: t.data.agent,
        lastActivityAt: act.lastActivityAt,
        lastUserInputAt: act.lastUserInputAt,
        isStreaming: act.isStreaming,
        previewOutput: act.previewOutput,
      };
    }
    const resolvedBranch = workspaceBranchByPath?.get(t.data.workingDirectory);
    return {
      id,
      kind: "shell" as const,
      name: "Shell",
      branchName: resolvedBranch ?? currentBranch ?? null,
      isMainRepo: resolvedBranch === undefined,
      lastActivityAt: act.lastActivityAt,
      lastUserInputAt: act.lastUserInputAt,
      isStreaming: act.isStreaming,
      previewOutput: act.previewOutput,
    };
  });

  const terminalSummariesRef = useRef<TerminalSessionSummary[]>([]);
  useEffect(() => {
    terminalSummariesRef.current = terminalSummaries;
  }, [terminalSummaries]);

  const onTerminalsChangeRef = useRef(onTerminalsChange);
  useEffect(() => {
    onTerminalsChangeRef.current = onTerminalsChange;
  }, [onTerminalsChange]);

  // `allTerminals` is a fresh array reference on every parent render (it's
  // derived inline, not memoized), so `terminalSummaries` above is too even
  // when nothing actually changed. Only notify the parent (which stores this
  // in state) when the derived content genuinely differs, otherwise this
  // effect would setState every render and loop forever.
  const lastNotifiedRef = useRef<string>("");
  useEffect(() => {
    const serialized = JSON.stringify(terminalSummaries);
    if (serialized === lastNotifiedRef.current) return;
    lastNotifiedRef.current = serialized;
    onTerminalsChangeRef.current?.(terminalSummaries);
  }, [terminalSummaries]);

  return {
    handleTerminalOutput,
    handleTerminalInput,
    handleTerminalIdlePulse,
    terminalSummariesRef,
  };
}
