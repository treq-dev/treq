import { isRemoteActionSupported } from "./remote-dispatch";

/**
 * Capabilities the current client may offer for a remote repository.
 * Native interactive PTY over russh is not wired on this client; the UI
 * must disable shell and agent PTY actions with this reason rather than
 * falling back to a system `ssh` executable.
 */
export const NATIVE_REMOTE_PTY_AVAILABLE = false;

export const NATIVE_REMOTE_PTY_REASON =
  "Interactive remote terminals require native SSH PTY support, which is not available yet. System ssh is not used as a fallback.";

export interface ActionCapability {
  supported: boolean;
  reason?: string;
}

export interface RemoteCapabilities {
  shell: ActionCapability;
  agentPty: ActionCapability;
  agentLifecycle: ActionCapability;
  splitCommit: ActionCapability;
  agentInput: ActionCapability;
}

export function remoteCapabilities(): RemoteCapabilities {
  return {
    shell: {
      supported: NATIVE_REMOTE_PTY_AVAILABLE,
      reason: NATIVE_REMOTE_PTY_REASON,
    },
    agentPty: {
      supported: NATIVE_REMOTE_PTY_AVAILABLE,
      reason: NATIVE_REMOTE_PTY_REASON,
    },
    agentLifecycle: { supported: true },
    splitCommit: {
      supported: isRemoteActionSupported("SplitCommit"),
      reason: "Commit split is not yet available on remote repositories.",
    },
    agentInput: {
      supported: isRemoteActionSupported("AgentInput"),
      reason:
        "Sending agent input is not yet available on remote repositories.",
    },
  };
}

export function localCapabilities(): RemoteCapabilities {
  return {
    shell: { supported: true },
    agentPty: { supported: true },
    agentLifecycle: { supported: true },
    splitCommit: { supported: true },
    agentInput: { supported: true },
  };
}

export function capabilitiesFor(isRemote: boolean): RemoteCapabilities {
  return isRemote ? remoteCapabilities() : localCapabilities();
}
