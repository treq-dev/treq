import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import type { InstanceStatusResponse } from "../../lib/api-types-remote";
import { RemoteManagedSetupPanel } from "./RemoteManagedSetupPanel";
import { RemoteUserManagedSetupPanel } from "./RemoteUserManagedSetupPanel";
import type {
  LocalKeyIdentity,
  UserManagedFormValues,
} from "./remoteSetupLabels";

export type { LocalKeyIdentity, UserManagedFormValues };

export type RemoteSetupMode = "choice" | "managed" | "user_managed";

export interface RemoteSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** Autocomplete-only suggestions read from `~/.ssh/config` (Goal 15 / Phase 1). Selecting one only fills the field. */
  sshConfigAliasSuggestions: string[];

  instanceStatus: InstanceStatusResponse | null;
  provisioningStage?: string;
  provisioningError?: string;

  onProvisionManaged: () => Promise<void>;
  onWake: () => Promise<void>;
  onReprovision: () => Promise<void>;
  onDeleteInstance: () => Promise<void>;
  onRevokeKey: (keyReference: string) => Promise<void>;
  onConnectManaged: () => Promise<void>;

  onRegisterUserManaged: (values: UserManagedFormValues) => Promise<void>;
  /** Open repositories on the existing managed instance without provisioning another. */
  onOpenManagedRepositories?: () => void;
}

/**
 * Remote setup flow: the two-choice entry point plus the managed and
 * user-managed configuration screens (PRD "UI requirements" / "Remote
 * setup"). Replaces the old bare host+path dialog. The two configuration
 * screens live in `RemoteManagedSetupPanel` and
 * `RemoteUserManagedSetupPanel`; this component only owns which screen is
 * showing.
 */
export function RemoteSetupDialog({
  open,
  onOpenChange,
  sshConfigAliasSuggestions,
  instanceStatus,
  provisioningStage,
  provisioningError,
  onProvisionManaged,
  onWake,
  onReprovision,
  onDeleteInstance,
  onRevokeKey,
  onConnectManaged,
  onRegisterUserManaged,
  onOpenManagedRepositories,
}: RemoteSetupDialogProps) {
  const [mode, setMode] = useState<RemoteSetupMode>("choice");

  useEffect(() => {
    if (open) setMode("choice");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {mode === "choice" && (
          <>
            <DialogHeader>
              <DialogTitle>Connect a remote repository</DialogTitle>
              <DialogDescription>
                Choose how the remote machine is managed.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-lg border border-border/60 p-4 text-left hover:border-primary/60 hover:bg-muted/40"
                onClick={() => setMode("managed")}
              >
                <div className="font-medium">Treq-managed Sprite</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Treq provisions and maintains one persistent development
                  Sprite for your account.
                </p>
              </button>
              <button
                type="button"
                className="rounded-lg border border-border/60 p-4 text-left hover:border-primary/60 hover:bg-muted/40"
                onClick={() => setMode("user_managed")}
              >
                <div className="font-medium">Your own VM</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connect to a machine you already run. You install Treq, JJ,
                  Git, and agents there yourself.
                </p>
              </button>
            </div>
          </>
        )}

        {mode === "managed" && (
          <>
            <DialogHeader>
              <DialogTitle>Treq-managed Sprite</DialogTitle>
              <DialogDescription>
                Treq manages lifecycle and runs typed commands through the
                authenticated Sprites API.
              </DialogDescription>
            </DialogHeader>
            <RemoteManagedSetupPanel
              instanceStatus={instanceStatus}
              provisioningStage={provisioningStage}
              provisioningError={provisioningError}
              onBack={() => setMode("choice")}
              onProvisionManaged={onProvisionManaged}
              onWake={onWake}
              onReprovision={onReprovision}
              onDeleteInstance={onDeleteInstance}
              onRevokeKey={onRevokeKey}
              onOpenRepositories={onOpenManagedRepositories}
              onConnectManaged={onConnectManaged}
            />
          </>
        )}

        {mode === "user_managed" && (
          <>
            <DialogHeader>
              <DialogTitle>Your own VM</DialogTitle>
              <DialogDescription>
                Enter the connection details exactly - Treq never infers trust
                from your local SSH configuration.
              </DialogDescription>
            </DialogHeader>
            <RemoteUserManagedSetupPanel
              sshConfigAliasSuggestions={sshConfigAliasSuggestions}
              onBack={() => setMode("choice")}
              onRegisterUserManaged={onRegisterUserManaged}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
