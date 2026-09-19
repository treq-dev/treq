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
  | "error"
  | "secure_storage_unavailable";

const DEVICE_KEY_COMMENT = "treq-mobile-device";
const LAST_REPO_KEY = "treq-mobile-last-remote-repo";

// Mirrors `SECURE_STORAGE_UNAVAILABLE_PREFIX` in
// `src-tauri/src/core/remote_device_key.rs`. `ensure_mobile_device_key`
// prefixes its error string this way when the device's secure key storage
// (Android Keystore / iOS Keychain, gated on biometrics) isn't usable, so
// this state can be told apart from a generic connection failure.
//
// Exported (not just used internally) so `RemoteConnectPanel.test.tsx` can
// assert this literal stays byte-for-byte in sync with the Rust constant -
// see that test for why a plain string prefix, rather than a generated
// binding, is what needs guarding here.
export const SECURE_STORAGE_UNAVAILABLE_PREFIX = "secure_storage_unavailable:";

function stripSecureStoragePrefix(message: string): string {
  return message.startsWith(SECURE_STORAGE_UNAVAILABLE_PREFIX)
    ? message.slice(SECURE_STORAGE_UNAVAILABLE_PREFIX.length)
    : message;
}

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
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith(SECURE_STORAGE_UNAVAILABLE_PREFIX)) {
        setError(stripSecureStoragePrefix(message));
        setStep("secure_storage_unavailable");
      } else {
        setError(message);
        setStep("error");
      }
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
      {!endpoint && step !== "secure_storage_unavailable" && (
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
      {step === "secure_storage_unavailable" ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <p className="font-medium text-destructive">
            Secure storage isn&apos;t set up on this device
          </p>
          <p className="text-muted-foreground">
            Treq stores this device&apos;s connection key in your device&apos;s
            secure keystore, which requires biometrics (Face ID, Touch ID, or
            fingerprint unlock) to be enrolled. Set up biometrics in your
            device settings, then try again.
          </p>
          {error && <p className="text-xs text-muted-foreground">{error}</p>}
          <button
            type="button"
            onClick={connect}
            className="self-start rounded-md border px-3 py-2 text-sm"
          >
            Try again
          </button>
        </div>
      ) : (
        error && <p className="text-sm text-destructive">{error}</p>
      )}
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
