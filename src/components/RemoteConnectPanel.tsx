import { useState } from "react";
import { ensureMobileDeviceKey } from "../lib/api";
import {
  getInstanceStatus,
  issueCertificate,
  registerClientKey,
} from "../lib/remote-control-plane";
import { dispatchOverSsh } from "../lib/remote-dispatch";
import type { SshEndpoint } from "../lib/api-types-remote";
import type { RemoteRepoProbe } from "../lib/api-types";
import { RemoteRepoScreen } from "./RemoteRepoScreen";

type Step =
  | "idle"
  | "device_key"
  | "register_key"
  | "instance_status"
  | "certificate"
  | "probe"
  | "connected"
  | "error";

const DEVICE_KEY_COMMENT = "treq-mobile-device";
const LAST_REPO_KEY = "treq-mobile-last-remote-repo";

/**
 * Mobile connectivity prototype (mobile PRD, Phase 2): registers this
 * device's key with the control plane, obtains a short-lived certificate
 * for the caller's managed instance, and probes a repository over the same
 * SSH dispatch path the desktop review screens use
 * (`dispatchOverSsh` / `TreqCommandRequest`).
 */
export function RemoteConnectPanel() {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<SshEndpoint | null>(null);
  const [repoPath, setRepoPath] = useState(
    () => localStorage.getItem(LAST_REPO_KEY) ?? "",
  );
  const [probe, setProbe] = useState<RemoteRepoProbe | null>(null);
  const [connectedRepo, setConnectedRepo] = useState<string | null>(null);

  async function connect() {
    setError(null);
    setEndpoint(null);
    try {
      setStep("device_key");
      const deviceKey = await ensureMobileDeviceKey();

      setStep("register_key");
      const clientKey = await registerClientKey({
        public_key: deviceKey.public_key,
        comment: DEVICE_KEY_COMMENT,
        idempotency_key: `register:${deviceKey.fingerprint_sha256}`,
      });

      setStep("instance_status");
      const { instance } = await getInstanceStatus();
      if (!instance) {
        throw new Error(
          "No managed instance provisioned for this account yet.",
        );
      }

      setStep("certificate");
      const issued = await issueCertificate({
        instance_id: instance.instance_id,
        key_id: clientKey.id,
      });

      setEndpoint(issued.endpoint);
      setStep("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  async function inspectRepo() {
    if (!endpoint || !repoPath) return;
    setError(null);
    setStep("probe");
    try {
      const result = await dispatchOverSsh<RemoteRepoProbe>(endpoint, {
        kind: "ProbeRepo",
        repo: repoPath,
      });
      setProbe(result);
      localStorage.setItem(LAST_REPO_KEY, repoPath);
      setConnectedRepo(repoPath);
      setStep("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-3">
      <h2 className="text-sm font-semibold">Remote instance</h2>
      {!endpoint && (
        <button
          type="button"
          onClick={connect}
          disabled={step !== "idle" && step !== "error"}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {step === "idle" || step === "error"
            ? "Connect to managed instance"
            : `Connecting (${step.replace("_", " ")})...`}
        </button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {endpoint && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Connected to {endpoint.hostname}:{endpoint.port}
          </p>
          <input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="Repository path on the instance"
            className="rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={inspectRepo}
            disabled={!repoPath || step === "probe"}
            className="rounded-md border px-3 py-2 text-sm"
          >
            {step === "probe" ? "Inspecting..." : "Inspect repository"}
          </button>
          {probe && !probe.exists && (
            <p className="text-sm text-destructive">
              Repository not found at {repoPath} on the instance.
            </p>
          )}
          {probe?.exists && connectedRepo && (
            <RemoteRepoScreen endpoint={endpoint} repo={connectedRepo} />
          )}
        </div>
      )}
    </section>
  );
}
