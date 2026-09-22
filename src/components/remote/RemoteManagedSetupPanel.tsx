import { useState } from "react";
import { Button } from "../ui/button";
import type { InstanceStatusResponse } from "../../lib/api-types-remote";
import { STAGE_LABELS } from "./remoteSetupLabels";

export interface RemoteManagedSetupPanelProps {
  instanceStatus: InstanceStatusResponse | null;
  provisioningStage?: string;
  provisioningError?: string;
  onBack: () => void;
  onProvisionManaged: () => Promise<void>;
  onWake: () => Promise<void>;
  onReprovision: () => Promise<void>;
  onDeleteInstance: () => Promise<void>;
  onRevokeKey: (keyReference: string) => Promise<void>;
  onOpenRepositories?: () => void;
  /** Connect action for an existing `ready` managed instance. */
  onConnectManaged: () => Promise<void>;
}

/** Treq-managed Sprite setup and lifecycle screen. */
export function RemoteManagedSetupPanel({
  instanceStatus,
  provisioningStage,
  provisioningError,
  onBack,
  onProvisionManaged,
  onWake,
  onReprovision,
  onDeleteInstance,
  onOpenRepositories,
  onConnectManaged,
}: RemoteManagedSetupPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [confirmingReprovision, setConfirmingReprovision] = useState(false);
  const [errorCopied, setErrorCopied] = useState(false);

  const copyError = async () => {
    if (!provisioningError) return;
    await navigator.clipboard.writeText(provisioningError);
    setErrorCopied(true);
  };

  const instanceRecord = instanceStatus?.instance ?? null;
  const existingInstance = instanceRecord?.provider_resource_id
    ? instanceRecord
    : null;
  const creationRetry =
    instanceRecord?.status === "failed" && !instanceRecord.provider_resource_id;
  const existingEndpoint = instanceStatus?.endpoint ?? null;
  const handleProvision = async () => {
    setSubmitting(true);
    try {
      await onProvisionManaged();
    } finally {
      setSubmitting(false);
    }
  };

  const handleConnect = async () => {
    setSubmitting(true);
    try {
      await onConnectManaged();
    } finally {
      setSubmitting(false);
    }
  };

  const handleReprovisionConfirmed = async () => {
    setSubmitting(true);
    try {
      await onReprovision();
      setConfirmingReprovision(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {existingInstance ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-border/60 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {STAGE_LABELS[existingInstance.status]}
              </span>
              <span className="text-muted-foreground">
                Sprite · gen {existingInstance.generation}
              </span>
            </div>
            {existingEndpoint && (
              <p className="mt-1 text-muted-foreground">
                {existingEndpoint.username}@{existingEndpoint.hostname}:
                {existingEndpoint.port}
              </p>
            )}
          </div>

          {provisioningError && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3">
              <pre
                role="alert"
                className="whitespace-pre-wrap break-words text-xs text-red-600 dark:text-red-400"
              >
                {provisioningError}
              </pre>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void copyError()}
              >
                {errorCopied ? "Copied" : "Copy error"}
              </Button>
            </div>
          )}

          {existingInstance.status === "ready" && (
            <div className="flex flex-wrap items-end gap-2">
              <Button
                size="sm"
                disabled={submitting}
                onClick={() => void handleConnect()}
              >
                Connect
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {existingEndpoint &&
              existingInstance.status === "ready" &&
              onOpenRepositories && (
                <Button size="sm" onClick={onOpenRepositories}>
                  Open repositories
                </Button>
              )}
            {(existingInstance.status === "suspended" ||
              existingInstance.status === "waking") && (
              <Button
                size="sm"
                disabled={submitting}
                onClick={() => void onWake()}
              >
                Wake
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => setConfirmingReprovision(true)}
            >
              Repair setup
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={submitting}
              onClick={() => void onDeleteInstance()}
            >
              Delete Sprite
            </Button>
          </div>

          {confirmingReprovision && (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
              <p>
                Repair reruns Treq setup in the existing Sprite. The Sprite and
                its filesystem are preserved.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  disabled={submitting}
                  onClick={() => void handleReprovisionConfirmed()}
                >
                  Confirm repair
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingReprovision(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Treq creates one Sprite for your account. Sprites manage location,
            CPU, memory, and persistent storage automatically.
          </p>

          {provisioningStage && (
            <p className="text-sm text-muted-foreground">{provisioningStage}</p>
          )}
          {provisioningError && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3">
              <pre
                role="alert"
                className="whitespace-pre-wrap break-words text-xs text-red-600 dark:text-red-400"
              >
                {provisioningError}
              </pre>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void copyError()}
              >
                {errorCopied ? "Copied" : "Copy error"}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        {!existingInstance && (
          <Button disabled={submitting} onClick={() => void handleProvision()}>
            {submitting
              ? "Creating..."
              : creationRetry
                ? "Retry Sprite creation"
                : "Create Sprite"}
          </Button>
        )}
      </div>
    </>
  );
}
