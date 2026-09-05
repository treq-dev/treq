import { useState } from "react";
import useSWR from "swr";
import {
  dispatchOverSsh,
  dispatchMutationOverSsh,
} from "../lib/remote-dispatch";
import type { SshEndpoint } from "../lib/api-types-remote";

interface AgentStatusResult {
  workspace: string;
  running: boolean;
  agent: string | null;
  pid: number | null;
  started_at: string | null;
  should_refresh: boolean;
}

const AGENTS = ["claude", "codex", "cursor-agent"];

/**
 * Phase 4 (agent control): start/status/logs/stop against the VM-local
 * agent supervisor via typed `TreqCommandRequest` dispatch. Non-interactive
 * `AgentInput` is available on the same protocol; this screen does not add
 * input controls.
 */
export function RemoteAgentScreen({
  endpoint,
  repo,
  workspace,
}: {
  endpoint: SshEndpoint;
  repo: string;
  workspace: string;
}) {
  const [agent, setAgent] = useState(AGENTS[0]);
  const [prompt, setPrompt] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const {
    data: status,
    error: statusError,
    mutate: mutateStatus,
  } = useSWR(
    ["remote-agent-status", endpoint.hostname, repo, workspace],
    () =>
      dispatchOverSsh<AgentStatusResult>(endpoint, {
        kind: "AgentStatus",
        repo,
        workspace,
      }),
    { refreshInterval: 4_000 },
  );

  const { data: logs, mutate: mutateLogs } = useSWR(
    status?.running
      ? ["remote-agent-logs", endpoint.hostname, repo, workspace]
      : null,
    () =>
      dispatchOverSsh<string>(endpoint, { kind: "AgentLogs", repo, workspace }),
    { refreshInterval: 4_000 },
  );

  async function startAgent() {
    setActionError(null);
    setBusy(true);
    try {
      const result = await dispatchMutationOverSsh(endpoint, {
        kind: "AgentStart",
        repo,
        workspace,
        agent,
        prompt,
        idempotency_key: `agent-start:${workspace}:${Date.now()}`,
      });
      if (result.status === "ambiguous") {
        setActionError(`Could not confirm the agent started: ${result.reason}`);
      }
      await mutateStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stopAgent() {
    setActionError(null);
    setBusy(true);
    try {
      await dispatchMutationOverSsh(endpoint, {
        kind: "AgentStop",
        repo,
        workspace,
      });
      await mutateStatus();
      await mutateLogs();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Agent · {workspace}</h2>
        <button
          type="button"
          onClick={() => mutateStatus()}
          className="self-end rounded-md border px-2 py-1 text-xs"
        >
          Refresh
        </button>
      </div>
      {statusError && (
        <p className="text-sm text-destructive">{String(statusError)}</p>
      )}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {status?.running ? (
        <div className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
          <p>
            Running <span className="font-mono">{status.agent}</span> (pid{" "}
            {status.pid})
          </p>
          <p className="text-xs text-muted-foreground">
            Started {status.started_at}
          </p>
          <button
            type="button"
            onClick={stopAgent}
            disabled={busy}
            className="self-start rounded-md border px-3 py-2 text-sm text-destructive"
          >
            {busy ? "Stopping..." : "Stop agent"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {AGENTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt for the agent"
            className="min-h-24 rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={startAgent}
            disabled={busy || !prompt}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {busy ? "Starting..." : "Start agent"}
          </button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Sending additional input to a running agent is not supported over this
        connection yet — interactive input requires a live terminal attach.
      </p>

      {logs && (
        <details open className="rounded-md border px-3 py-2 text-xs">
          <summary className="cursor-pointer text-sm font-semibold">
            Logs
          </summary>
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">
            {logs}
          </pre>
        </details>
      )}
    </section>
  );
}
