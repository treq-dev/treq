/* eslint-disable max-lines */

import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR from "swr";
import { useLocation } from "wouter";
import { useAutoUpdate } from "../hooks/useAutoUpdate";
import { useKeyboardShortcut } from "../hooks/useKeyboard";
import { useMutation } from "../hooks/useMutation";
import { useTwoFingerSwipe } from "../hooks/useTwoFingerSwipe";
import { useWorkspaceHierarchy } from "../hooks/useWorkspaceHierarchy";
import {
  type AgentDeepLinkRequest,
  findWorkspaceByBranch,
  isProcessedAgentRequest,
  markProcessedAgentRequest,
  parseAgentDeepLinks,
  popPendingAgentRequests,
  processAgentDeepLinkRequests,
} from "../lib/agentDeepLink";
import {
  acknowledgeAgentDispatch,
  addPromptHistory,
  archiveWorkspace,
  buildExplicitAliasSshEndpoint,
  checkAndRebaseWorkspaces,
  createSession,
  deleteWorkspace,
  getRepoCurrentBranch,
  getRepoDefaultBranch,
  getRepoSetting,
  getSessions,
  getSetting,
  getWorkspaces,
  initRepo,
  listLocalSshIdentities,
  listRepoBranches,
  listSshHosts,
  listWorkspaceStatuses,
  moveWorkspaceChanges,
  readLocalSshPublicKey,
  remoteCloneRepoOverSsh,
  remoteOpenRepoOverSsh,
  remoteProbeRepoOverSsh,
  selectFolder,
  setSessionModel,
  setSetting,
  setWindowRepoPath,
  updateSessionAccess,
  type Workspace,
} from "../lib/api";
import type { RemoteRepository } from "../lib/api-types";
import type {
  InstanceStatusResponse,
  RegionCode,
  RemoteRepoProbe,
  RepositoryInspection,
  SizePreset,
  SshEndpoint,
} from "../lib/api-types-remote";
import { RemoteAmbiguousMutationDialog } from "./remote/RemoteAmbiguousMutationDialog";
import { RemoteCapabilityNotice } from "./remote/RemoteCapabilityNotice";
import {
  activeRepositoryFromRemote,
  localActiveRepository,
  repositoryCacheKey,
  type PersistedRemoteRepository,
} from "../lib/active-repository";
import { ActiveRepositoryProvider } from "../lib/active-repository-context";
import { capabilitiesFor } from "../lib/remote-capabilities";
import { invalidateRemoteRepositoryData } from "../lib/remote-mutation-ui";
import {
  useRemoteAgentRefresh,
  useRemoteChangeMarkerWatch,
} from "../hooks/useRemoteRefresh";
import { ARTIFACTS_BASE_PATH, artifactsPath } from "../lib/artifactRoutes";
import {
  type ChangeFilesMoveRequest,
  dispatchRefreshWorkspaceChanges,
} from "../lib/change-file-drag";
import {
  GITHUB_BASE_PATH,
  githubDetailPath,
  githubListPath,
  stateFilterForPrState,
} from "../lib/githubRoutes";
import { LINEAR_BASE_PATH } from "../lib/linearRoutes";
import { openRepositoryAtPath as openRepositoryAtPathShared } from "../lib/open-repository";
import type {
  GitHubIssueAttachment,
  LinearIssueAttachment,
} from "../lib/promptAttachments";
import {
  deleteInstance as deleteManagedInstance,
  ensureInstance,
  getInstanceStatus,
  issueCertificate,
  listRegions,
  listSizePresets,
  registerClientKey,
  reprovisionInstance,
  revokeClientKey,
  wakeInstance,
} from "../lib/remote-control-plane";
import {
  listUserManagedEndpoints,
  saveUserManagedEndpoint,
  trustedHostKeyFromFingerprint,
  publicKeyAuthentication,
  type SavedRemoteRepositoryRecord,
  type UserManagedEndpointRecord,
} from "../lib/remote-endpoints";
import {
  dispatchMutationOverSsh,
  dispatchOverSsh,
} from "../lib/remote-dispatch";
import {
  LAST_OPENED_REMOTE_REPO_ID_KEY,
  canonicalizeRemotePath,
  getSavedRemoteRepository,
  listSavedRepositoriesForEndpoint,
  rememberLastOpenedRemoteRepository,
  restoreSavedRemoteRepository,
  upsertSavedRemoteRepository,
} from "../lib/remote-repository";
import {
  connectExistingReadyInstance,
  connectManagedInstance,
  reauthenticateManagedInstance,
  waitForInstanceReady,
  type ManagedConnectionDeps,
  type RenewalController,
} from "../lib/managed-ssh-connection";
import { startManagedCertificateRenewal } from "../lib/remote-cert-lifecycle";
import { useRemoteCutoffStore } from "../stores/remoteCutoffStore";
import { remoteForceCutoff } from "../lib/api-extra";
import { RemoteRepositorySelector } from "./remote/RemoteRepositorySelector";
import { invalidateReviewChangeCount } from "../lib/review-change-count";
import {
  clearSWRCache,
  fetchAndCache,
  invalidateQueries,
  pollMs,
} from "../lib/swr-cache";
import { getFullWorkspacePath } from "../lib/utils";
import {
  buildWorkspaceTree,
  flattenWorkspaceTree,
} from "../lib/workspace-tree";
import {
  useFeaturePreviewStore,
  usePreviewFeature,
} from "../stores/featurePreviewStore";
import { useSidebarWidthStore } from "../stores/sidebarWidthStore";
import { AgentPromptDialog } from "./AgentPromptDialog";
import { ArtifactsPage } from "./ArtifactsPage";
import { CommandPalette } from "./CommandPalette";
import { ErrorBoundary } from "./ErrorBoundary";
import { GitHubPanel } from "./GitHubPanel";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { LinearPanel } from "./LinearPanel";
import { MergePreviewPage } from "./MergePreviewPage";
import { Onboarding } from "./Onboarding";
import { PromptHistoryModal } from "./PromptHistoryModal";
import {
  type LocalKeyIdentity,
  RemoteSetupDialog,
  type UserManagedFormValues,
} from "./remote/RemoteSetupDialog";
import {
  connectionStateFromInstanceState,
  RemoteStatusBanner,
} from "./remote/RemoteStatusBanner";
import { SettingsPage } from "./SettingsPage";
import { ShowWorkspace } from "./ShowWorkspace";
import { StashModal } from "./StashModal";
import type { BranchListItem } from "./TargetBranchSelector";
import { TerminalMissionControl } from "./TerminalMissionControl";
import type {
  ClaudeSessionData,
  TerminalSessionSummary,
} from "./terminal/types";
import {
  UnifiedWorkspaceDialog,
  type WorkspaceDialogDefaults,
} from "./UnifiedWorkspaceDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";
import { useToast } from "./ui/toast";
import { WorkspacePicker } from "./WorkspacePicker";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import {
  WorkspaceTerminalPane,
  type WorkspaceTerminalPaneHandle,
} from "./WorkspaceTerminalPane";

function sshEndpointFromUserManaged(
  record: UserManagedEndpointRecord,
): SshEndpoint {
  return {
    id: record.id,
    instance_id: null,
    source: { type: "user_managed" },
    hostname: record.hostname,
    port: record.port,
    username: record.username,
    host_keys: [trustedHostKeyFromFingerprint(record.host_key_fingerprint)],
    authentication: publicKeyAuthentication(record.auth_identity_reference),
  };
}

function generationFromEndpoint(
  endpoint: SshEndpoint,
  fallback: number,
): number {
  if (endpoint.source.type === "managed") return endpoint.source.generation;
  return fallback;
}

type ViewMode =
  | "session"
  | "show-workspace"
  | "settings"
  | "artifacts"
  | "merge-preview"
  | "github"
  | "linear";

type SessionOpenOptions = {
  initialPrompt?: string;
  promptLabel?: string;
  forceNew?: boolean;
  sessionName?: string;
  selectedFilePath?: string;
};

interface DashboardProps {
  initialViewMode?: ViewMode;
}
export const Dashboard: React.FC<DashboardProps> = ({
  initialViewMode = "show-workspace",
}) => {
  const [repoPath, setRepoPath] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("repo") || "";
  });
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [homeRepoDisplayRef, setHomeRepoDisplayRef] = useState<string | null>(
    null,
  );
  const [unifiedDialogDefaults, setUnifiedDialogDefaults] =
    useState<WorkspaceDialogDefaults | null>(null);
  const [pendingChangeMove, setPendingChangeMove] = useState<{
    files: string[];
    sourceBranch: string;
    destinationBranch: string;
    destinationLabel: string;
  } | null>(null);
  const [changeMovePending, setChangeMovePending] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [location, navigate] = useLocation();
  const remoteSshEnabled = usePreviewFeature("remoteSsh");
  const linearIntegrationEnabled = usePreviewFeature("linearIntegration");
  const previousViewModeRef = useRef<ViewMode>(
    initialViewMode === "settings" ? "show-workspace" : initialViewMode,
  );
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(
    null,
  );
  const [mergeWorkspace, setMergeWorkspace] = useState<Workspace | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showTerminalMissionControl, setShowTerminalMissionControl] =
    useState(false);
  const [showAgentPromptDialog, setShowAgentPromptDialog] = useState(false);
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const [promptHistoryFocusId, setPromptHistoryFocusId] = useState<
    number | null
  >(null);
  const [showStashModal, setShowStashModal] = useState(false);
  const [runPromptRequest, setRunPromptRequest] = useState<{
    prompt?: string;
    workspaceId: number | null;
    githubIssue?: GitHubIssueAttachment | null;
    linearIssue?: LinearIssueAttachment | null;
  } | null>(null);
  const [showBranchSwitcher, setShowBranchSwitcher] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [showWorkspaceDeletion, setShowWorkspaceDeletion] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [pendingSessionData, setPendingSessionData] = useState<
    Map<
      number,
      {
        pendingPrompt?: string;
        permissionMode?: "plan" | "acceptEdits";
        agent?: "claude" | "codex" | "cursor";
        workspacePath?: string | null;
      }
    >
  >(new Map());
  const [sessionSelectedFile, setSessionSelectedFile] = useState<string | null>(
    null,
  );
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<number>>(
    new Set(),
  );
  const [archivingWorkspaceIds, setArchivingWorkspaceIds] = useState<
    Set<number>
  >(new Set());
  const [exitingWorkspaceIds, setExitingWorkspaceIds] = useState<Set<number>>(
    new Set(),
  );
  const lastSelectedWorkspaceIndexRef = useRef<number | null>(null);
  const [deferredAgentRequests, setDeferredAgentRequests] = useState<
    AgentDeepLinkRequest[]
  >([]);
  const [, setShowWorkspaceActiveTab] = useState("overview");
  const [terminalSessionSummaries, setTerminalSessionSummaries] = useState<
    TerminalSessionSummary[]
  >([]);
  const [showRemoteSshDialog, setShowRemoteSshDialog] = useState(false);
  const [remoteSshHost, setRemoteSshHost] = useState("");
  const [remoteSshPath, setRemoteSshPath] = useState("~/src/project");
  const [remoteSshRepoUrl, setRemoteSshRepoUrl] = useState("");
  const [remoteSshNeedsClone, setRemoteSshNeedsClone] = useState(false);
  const [remoteSshSubmitting, setRemoteSshSubmitting] = useState(false);
  const [remoteSshStage, setRemoteSshStage] = useState("");
  const [remoteSshHosts, setRemoteSshHosts] = useState<string[]>([]);
  const [remoteSshFingerprint, setRemoteSshFingerprint] = useState("");
  const [activeRemoteRepo, setActiveRemoteRepo] =
    useState<RemoteRepository | null>(null);

  // -- Phase 6: remote setup flow (managed + user-owned endpoints) ---------
  const [showRemoteSetupDialog, setShowRemoteSetupDialog] = useState(false);
  const [remoteRegions, setRemoteRegions] = useState<RegionCode[]>([]);
  const [remoteSizePresets, setRemoteSizePresets] = useState<SizePreset[]>([]);
  const [localKeyIdentities, setLocalKeyIdentities] = useState<
    LocalKeyIdentity[]
  >([]);
  const [instanceStatus, setInstanceStatus] =
    useState<InstanceStatusResponse | null>(null);
  const [provisioningStage, setProvisioningStage] = useState<string>();
  const [provisioningError, setProvisioningError] = useState<string>();
  // Explicit user-managed or managed endpoints carry a native SSH identity.
  // Alias-backed repositories still use the same workspace tree; they
  // dispatch through `remote_dispatch_local` until an endpoint with a
  // pinned host key is attached (native SSH does not resolve ~/.ssh/config).
  const [activeSshEndpoint, setActiveSshEndpoint] =
    useState<SshEndpoint | null>(null);
  const [activeEndpointGeneration, setActiveEndpointGeneration] = useState(0);
  const [explicitEndpointRepoPath, setExplicitEndpointRepoPath] =
    useState("~/src/project");
  const [explicitEndpointError, setExplicitEndpointError] = useState<string>();
  const [explicitEndpointRepoConnected, setExplicitEndpointRepoConnected] =
    useState(false);
  const [savedRemoteRepos, setSavedRemoteRepos] = useState<
    SavedRemoteRepositoryRecord[]
  >([]);
  const [selectedSavedRepoId, setSelectedSavedRepoId] = useState<string | null>(
    null,
  );
  const [explicitEndpointProbe, setExplicitEndpointProbe] =
    useState<RemoteRepoProbe | null>(null);
  const [explicitEndpointCloneUrl, setExplicitEndpointCloneUrl] = useState("");
  const [confirmInitRemoteRepo, setConfirmInitRemoteRepo] = useState(false);
  const [explicitGenerationTransition, setExplicitGenerationTransition] =
    useState(false);
  const [remoteRepoBusy, setRemoteRepoBusy] = useState(false);

  const refreshSavedRemoteRepos = async (
    endpointId: string,
    generation: number,
  ) => {
    setSavedRemoteRepos(
      await listSavedRepositoriesForEndpoint(endpointId, generation),
    );
  };

  // Builds the `PersistedRemoteRepository` the workspace tree (via
  // `activeRepository`/`ActiveRepositoryProvider`) keys off of, from a saved
  // descriptor plus the inspection that just proved the path is a real
  // repository. Only called once reconnect + trust + inspect have all
  // succeeded (see `restoreSavedRemoteRepository` and the handlers below).
  const connectedRepoFromDescriptor = (
    descriptor: SavedRemoteRepositoryRecord,
    endpoint: SshEndpoint,
    inspection?: RepositoryInspection,
  ): PersistedRemoteRepository => ({
    host: endpoint.hostname,
    path: descriptor.canonical_remote_path,
    display_name: descriptor.display_name,
    repo_uri: `ssh://${endpoint.username}@${endpoint.hostname}:${endpoint.port}${descriptor.canonical_remote_path}`,
    inspection: inspection ?? {
      root: descriptor.canonical_remote_path,
      repository_type: "jj",
      current_branch: null,
      default_branch: "main",
      current_change_id: "",
      current_commit_id: "",
      descriptor: {
        id: descriptor.id,
        location: {
          type: "ssh",
          host: endpoint.hostname,
          path: descriptor.canonical_remote_path,
        },
        display_name: descriptor.display_name,
      },
    },
    endpoint,
    endpoint_id: descriptor.endpoint_id,
    endpoint_generation: descriptor.endpoint_generation,
  });

  const markRemoteRepoOpen = async (
    descriptor: SavedRemoteRepositoryRecord,
    endpoint?: SshEndpoint,
    inspection?: RepositoryInspection,
  ) => {
    await rememberLastOpenedRemoteRepository(descriptor.id);
    setSelectedSavedRepoId(descriptor.id);
    setExplicitEndpointRepoPath(descriptor.canonical_remote_path);
    setExplicitEndpointRepoConnected(true);
    await refreshSavedRemoteRepos(
      descriptor.endpoint_id,
      descriptor.endpoint_generation,
    );
    const connectionEndpoint = endpoint ?? activeSshEndpoint;
    if (connectionEndpoint) {
      const connectedRepo = connectedRepoFromDescriptor(
        descriptor,
        connectionEndpoint,
        inspection,
      );
      await setSetting("last_opened_remote_repo", JSON.stringify(connectedRepo));
      setActiveRemoteRepo(connectedRepo);
    }
  };

  const inspectAndRegisterPath = async (
    endpoint: SshEndpoint,
    generation: number,
    path: string,
  ) => {
    const canonical = canonicalizeRemotePath(path);
    const inspection = await dispatchOverSsh<RepositoryInspection>(endpoint, {
      kind: "InspectRepository",
      repo: canonical,
    });
    const descriptor = await upsertSavedRemoteRepository({
      endpoint_id: endpoint.id,
      endpoint_generation: generation,
      remote_path: canonical,
      last_successful_trust_validation: new Date().toISOString(),
    });
    await markRemoteRepoOpen(descriptor, endpoint, inspection);
  };

  // The currently registered client key for the managed instance, so a
  // revocation of *this* key (PRD "Revoking the active key must immediately
  // cut off the active endpoint") and reauthentication after a hard cutoff
  // both know which local identity to use.
  const [managedKeyId, setManagedKeyId] = useState<string | null>(null);
  // Last local identity reference used to connect the managed instance, so
  // wake/reconnect and reauthentication can re-run the same
  // register-key -> issue-certificate sequence without asking the user to
  // reselect their identity every time.
  const [selectedKeyReference, setSelectedKeyReference] = useState<
    string | null
  >(null);
  const renewalControllerRef = useRef<RenewalController | null>(null);
  const cutoffs = useRemoteCutoffStore((s) => s.cutoffs);
  const clearRemoteCutoff = useRemoteCutoffStore((s) => s.clearCutoff);

  useEffect(() => {
    void useRemoteCutoffStore.getState().startListening();
    return () => useRemoteCutoffStore.getState().stopListening();
  }, []);

  // Stop renewal on disconnect or endpoint replacement (PRD "Stop renewal on
  // disconnect or endpoint replacement") - this fires whenever
  // `activeSshEndpoint` changes identity (including to null) or the
  // component unmounts, before any new renewal loop for a replacement
  // endpoint is started by the handler that set it.
  useEffect(
    () => () => {
      renewalControllerRef.current?.stop();
      renewalControllerRef.current = null;
    },
    [activeSshEndpoint],
  );

  const managedConnectionDeps = (): ManagedConnectionDeps => ({
    readPublicKey: readLocalSshPublicKey,
    registerClientKey: async (publicKey, comment, idempotencyKey) => {
      const key = await registerClientKey({
        public_key: publicKey,
        comment,
        idempotency_key: idempotencyKey,
      });
      setManagedKeyId(key.id);
      return key;
    },
    ensureInstance: (region, size, idempotencyKey) =>
      ensureInstance({
        region,
        size_preset: size,
        idempotency_key: idempotencyKey,
      }),
    getInstanceStatus,
    issueCertificate: (instanceId, keyId) =>
      issueCertificate({ instance_id: instanceId, key_id: keyId }),
    activateEndpoint: (endpoint) => {
      renewalControllerRef.current?.stop();
      setActiveSshEndpoint(endpoint);
      setActiveEndpointGeneration(
        endpoint.source.type === "managed" ? endpoint.source.generation : 0,
      );
    },
    startRenewal: (lease, onRenewed) =>
      startManagedCertificateRenewal(lease, onRenewed),
    clearCutoff: (endpointId) => clearRemoteCutoff(endpointId),
  });

  const handleConnectExplicitEndpointRepo = async () => {
    if (!activeSshEndpoint) return;
    setExplicitEndpointError(undefined);
    try {
      const probe = await dispatchOverSsh<RemoteRepoProbe>(activeSshEndpoint, {
        kind: "ProbeRepo",
        repo: explicitEndpointRepoPath,
      });
      setExplicitEndpointProbe(probe);
      if (!probe.is_repo) {
        setExplicitEndpointError(
          probe.needs_clone
            ? "No repository at that path. Clone or initialize it."
            : "No repository found at that path on the remote machine.",
        );
        return;
      }
      await inspectAndRegisterPath(
        activeSshEndpoint,
        activeEndpointGeneration,
        explicitEndpointRepoPath,
      );
    } catch (error) {
      setExplicitEndpointError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleProbeExplicitEndpointRepo = async () => {
    if (!activeSshEndpoint) return;
    setExplicitEndpointError(undefined);
    setRemoteRepoBusy(true);
    try {
      const probe = await dispatchOverSsh<RemoteRepoProbe>(activeSshEndpoint, {
        kind: "ProbeRepo",
        repo: explicitEndpointRepoPath,
      });
      setExplicitEndpointProbe(probe);
    } catch (error) {
      setExplicitEndpointError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRemoteRepoBusy(false);
    }
  };

  const handleCloneExplicitEndpointRepo = async () => {
    if (!activeSshEndpoint || !explicitEndpointCloneUrl.trim()) return;
    setExplicitEndpointError(undefined);
    setRemoteRepoBusy(true);
    try {
      const result = await dispatchMutationOverSsh<RepositoryInspection>(
        activeSshEndpoint,
        {
          kind: "CloneRepo",
          repo_url: explicitEndpointCloneUrl.trim(),
          destination: canonicalizeRemotePath(explicitEndpointRepoPath),
          idempotency_key: `clone-${activeSshEndpoint.id}-${Date.now()}`,
        },
      );
      if (result.status === "ambiguous") {
        setExplicitEndpointError(result.reason);
        return;
      }
      await inspectAndRegisterPath(
        activeSshEndpoint,
        activeEndpointGeneration,
        explicitEndpointRepoPath,
      );
    } catch (error) {
      setExplicitEndpointError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRemoteRepoBusy(false);
    }
  };

  const handleInitExplicitEndpointRepo = async () => {
    if (!activeSshEndpoint || !confirmInitRemoteRepo) return;
    setExplicitEndpointError(undefined);
    setRemoteRepoBusy(true);
    try {
      const result = await dispatchMutationOverSsh<RepositoryInspection>(
        activeSshEndpoint,
        {
          kind: "InitRepo",
          repo: canonicalizeRemotePath(explicitEndpointRepoPath),
          idempotency_key: `init-${activeSshEndpoint.id}-${Date.now()}`,
        },
      );
      if (result.status === "ambiguous") {
        setExplicitEndpointError(result.reason);
        return;
      }
      await inspectAndRegisterPath(
        activeSshEndpoint,
        activeEndpointGeneration,
        explicitEndpointRepoPath,
      );
    } catch (error) {
      setExplicitEndpointError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRemoteRepoBusy(false);
    }
  };

  const handleSelectSavedRemoteRepo = async (id: string) => {
    if (!activeSshEndpoint) return;
    const descriptor = savedRemoteRepos.find((repo) => repo.id === id);
    if (!descriptor) return;
    setSelectedSavedRepoId(id);
    setExplicitEndpointRepoPath(descriptor.canonical_remote_path);
    setExplicitEndpointError(undefined);
    setRemoteRepoBusy(true);
    try {
      const result = await restoreSavedRemoteRepository({
        descriptor,
        currentGeneration: activeEndpointGeneration,
        explicitGenerationTransition,
        reconnect: async () => {
          try {
            await dispatchOverSsh(activeSshEndpoint, {
              kind: "ProbeRepo",
              repo: descriptor.canonical_remote_path,
            });
            return true;
          } catch {
            return false;
          }
        },
        validateHostKey: async () =>
          activeSshEndpoint.host_keys.some(
            (key) => key.fingerprint_sha256.length > 0,
          ),
        inspect: (canonicalPath) =>
          dispatchOverSsh<RepositoryInspection>(activeSshEndpoint, {
            kind: "InspectRepository",
            repo: canonicalPath,
          }),
      });
      if (!result.ok) {
        setExplicitEndpointRepoConnected(false);
        setExplicitEndpointError(
          result.reason === "generation_mismatch"
            ? "Endpoint generation changed. Confirm a trust transition before restoring."
            : `Restore refused: ${result.reason.replace(/_/g, " ")}.`,
        );
        return;
      }
      setExplicitGenerationTransition(false);
      await markRemoteRepoOpen(
        result.descriptor,
        activeSshEndpoint,
        result.inspection,
      );
    } finally {
      setRemoteRepoBusy(false);
    }
  };

  const activeRepository = useMemo(() => {
    if (repoPath) return localActiveRepository(repoPath);
    if (activeRemoteRepo) {
      return activeRepositoryFromRemote(
        activeRemoteRepo as PersistedRemoteRepository,
        activeSshEndpoint,
      );
    }
    return null;
  }, [repoPath, activeRemoteRepo, activeSshEndpoint, activeEndpointGeneration]);

  const isRemoteActive = activeRepository?.location.type === "ssh";
  const dataRepoPath = activeRepository?.canonicalPath ?? repoPath;
  const queryRepoKey = activeRepository
    ? repositoryCacheKey(activeRepository)
    : repoPath;
  const remoteCaps = capabilitiesFor(Boolean(isRemoteActive));
  const cutoffReason = useRemoteCutoffStore((s) =>
    activeRepository?.endpointId
      ? s.cutoffs[activeRepository.endpointId]
      : undefined,
  );

  useEffect(() => {
    void useRemoteCutoffStore.getState().startListening();
    return () => useRemoteCutoffStore.getState().stopListening();
  }, []);

  useRemoteChangeMarkerWatch(
    isRemoteActive ? activeRepository : null,
    selectedWorkspace?.id ?? null,
  );
  useRemoteAgentRefresh(
    isRemoteActive ? activeRepository : null,
    selectedWorkspace?.id ?? null,
  );

  const handleOpenRemoteSetup = async () => {
    if (!useFeaturePreviewStore.getState().flags.remoteSsh) return;
    setProvisioningError(undefined);
    try {
      const [hosts, identities, regions, sizes, status] = await Promise.all([
        listSshHosts().catch(() => []),
        listLocalSshIdentities().catch(() => []),
        listRegions().catch(() => []),
        listSizePresets().catch(() => []),
        getInstanceStatus().catch(() => null),
      ]);
      setRemoteSshHosts(hosts.map((h) => h.alias));
      setLocalKeyIdentities(
        identities.map((identity) => ({
          reference: identity.reference,
          label: identity.label,
          fingerprint: identity.fingerprint_sha256,
        })),
      );
      setRemoteRegions(regions);
      setRemoteSizePresets(sizes);
      setInstanceStatus(status);
    } catch {
      // Best-effort: the dialog still opens and shows what it could load.
    }
    setShowRemoteSetupDialog(true);
  };

  const refreshInstanceStatus = async () => {
    try {
      setInstanceStatus(await getInstanceStatus());
    } catch {
      // Leave the last-known status in place; the banner reflects staleness.
    }
  };

  // Full identity -> registration -> certificate -> endpoint sequence (PRD
  // "Managed VM certificate flow"), plus the initial silent-renewal start.
  // See `src/lib/managed-ssh-connection.ts` for the state machine itself.
  const handleProvisionManaged = async (
    region: RegionCode,
    size: SizePreset,
    keyReference: string,
  ) => {
    setProvisioningError(undefined);
    setProvisioningStage("Requesting provisioning...");
    try {
      setProvisioningStage("Registering SSH key...");
      const result = await connectManagedInstance(managedConnectionDeps(), {
        region,
        size,
        keyReference,
      });
      const status = await getInstanceStatus();
      setInstanceStatus(status);
      if (status.endpoint) {
        const generation = generationFromEndpoint(
          status.endpoint,
          status.instance?.generation ?? 0,
        );
        setActiveSshEndpoint(status.endpoint);
        setActiveEndpointGeneration(generation);
        setExplicitEndpointRepoConnected(false);
        setShowRemoteSetupDialog(false);
        void refreshSavedRemoteRepos(status.endpoint.id, generation);
      }
      renewalControllerRef.current = result.renewal;
      setSelectedKeyReference(keyReference);
    } catch (error) {
      setProvisioningError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setProvisioningStage(undefined);
    }
  };

  // Connect action for an existing ready managed instance (required behavior
  // "Add a clear Connect action for an existing ready managed instance") -
  // still runs key registration + certificate issuance + renewal, just skips
  // provisioning/readiness polling since the instance is already `ready`.
  const handleConnectManaged = async (keyReference: string) => {
    if (!instanceStatus) return;
    setProvisioningError(undefined);
    try {
      const result = await connectExistingReadyInstance(
        managedConnectionDeps(),
        { status: instanceStatus, keyReference },
      );
      renewalControllerRef.current = result.renewal;
      setSelectedKeyReference(keyReference);
      setShowRemoteSetupDialog(false);
    } catch (error) {
      setProvisioningError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // Wake/reconnect ordering (required behavior): wake, poll readiness,
  // refresh credentials (fresh certificate), validate generation/host trust
  // (via `activateEndpoint` replacing the endpoint), reconnect - only then is
  // interaction restored (the new `activeSshEndpoint` is what gates it).
  const handleWakeManaged = async (keyReference?: string) => {
    const instanceId = instanceStatus?.instance?.instance_id;
    const resolvedKeyReference = keyReference ?? selectedKeyReference;
    if (!instanceId || !resolvedKeyReference) return;
    setProvisioningError(undefined);
    try {
      await wakeInstance({
        instance_id: instanceId,
        idempotency_key: `wake-${instanceId}`,
      });
      const deps = managedConnectionDeps();
      const readyStatus = await waitForInstanceReady(deps);
      const result = await connectExistingReadyInstance(deps, {
        status: readyStatus,
        keyReference: resolvedKeyReference,
      });
      renewalControllerRef.current = result.renewal;
      setSelectedKeyReference(resolvedKeyReference);
      await refreshInstanceStatus();
    } catch (error) {
      setProvisioningError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // Reauthentication after a hard cutoff (PRD "The user regains access only
  // by reauthenticating and obtaining a new certificate through the normal
  // registration and issuance flow"). Cutoff is cleared only once
  // `reauthenticateManagedInstance` confirms fresh certificate issuance
  // succeeded.
  const handleReauthenticateManaged = async (keyReference?: string) => {
    const resolvedKeyReference = keyReference ?? selectedKeyReference;
    if (
      !activeSshEndpoint ||
      !instanceStatus?.instance ||
      !resolvedKeyReference
    )
      return;
    setProvisioningError(undefined);
    try {
      const result = await reauthenticateManagedInstance(
        managedConnectionDeps(),
        {
          instanceId: instanceStatus.instance.instance_id,
          endpointId: activeSshEndpoint.id,
          keyReference: resolvedKeyReference,
        },
      );
      renewalControllerRef.current = result.renewal;
      setSelectedKeyReference(resolvedKeyReference);
    } catch (error) {
      setProvisioningError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleReprovisionManaged = async (
    region: RegionCode,
    size: SizePreset,
  ) => {
    const instanceId = instanceStatus?.instance?.instance_id;
    if (!instanceId) return;
    setProvisioningError(undefined);
    try {
      await reprovisionInstance({
        instance_id: instanceId,
        region,
        size_preset: size,
        idempotency_key: `reprovision-${instanceId}-${Date.now()}`,
      });
      setExplicitGenerationTransition(true);
      await refreshInstanceStatus();
    } catch (error) {
      setProvisioningError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleDeleteManagedInstance = async () => {
    const instanceId = instanceStatus?.instance?.instance_id;
    if (!instanceId) return;
    setProvisioningError(undefined);
    try {
      await deleteManagedInstance({
        instance_id: instanceId,
        idempotency_key: `delete-${instanceId}-${Date.now()}`,
      });
      await refreshInstanceStatus();
    } catch (error) {
      setProvisioningError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // Revoking the active key must immediately cut off the active endpoint
  // (required behavior) - this is a client-driven mirror of the same forced
  // cutoff the certificate-renewal loop performs when the control plane
  // reports the key revoked on the next renewal attempt, so access is
  // blocked right away rather than only after the current certificate would
  // otherwise have been silently renewed.
  const handleRevokeKey = async (keyReference: string) => {
    setProvisioningError(undefined);
    const keyId = managedKeyId ?? keyReference;
    try {
      await revokeClientKey({
        key_id: keyId,
        idempotency_key: `revoke-${keyId}`,
      });
      if (activeSshEndpoint && managedKeyId) {
        renewalControllerRef.current?.stop();
        renewalControllerRef.current = null;
        await remoteForceCutoff(activeSshEndpoint.id, "key_revoked");
        useRemoteCutoffStore
          .getState()
          .recordCutoff(activeSshEndpoint.id, "key_revoked");
      }
    } catch (error) {
      setProvisioningError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleRegisterUserManaged = async (values: UserManagedFormValues) => {
    setProvisioningError(undefined);
    const id = `user-managed-${Date.now()}`;
    await saveUserManagedEndpoint({
      id,
      display_name: values.display_name,
      hostname: values.hostname,
      port: values.port,
      username: values.username,
      host_key_fingerprint: values.host_key_fingerprint,
      auth_identity_reference: values.auth_identity_reference,
      alias: values.alias,
      created_at: new Date().toISOString(),
    });

    if (values.alias) {
      // Alias mode: keep using the working alias-based probe/clone/terminal
      // path below rather than the native transport, which cannot resolve
      // `~/.ssh/config` aliases (it requires an explicit trusted host key).
      setShowRemoteSetupDialog(false);
      await handleOpenRemoteSsh();
      setRemoteSshHost(values.alias);
      return;
    }

    const endpoint = sshEndpointFromUserManaged({
      id,
      display_name: values.display_name,
      hostname: values.hostname,
      port: values.port,
      username: values.username,
      host_key_fingerprint: values.host_key_fingerprint,
      auth_identity_reference: values.auth_identity_reference,
      alias: values.alias,
      created_at: new Date().toISOString(),
    });
    setActiveSshEndpoint(endpoint);
    setActiveEndpointGeneration(0);
    setExplicitEndpointRepoConnected(false);
    setShowRemoteSetupDialog(false);
    await refreshSavedRemoteRepos(endpoint.id, 0);
  };

  const handleOpenManagedRepositories = () => {
    const endpoint = instanceStatus?.endpoint;
    if (!endpoint) return;
    const generation = generationFromEndpoint(
      endpoint,
      instanceStatus?.instance?.generation ?? 0,
    );
    setActiveSshEndpoint(endpoint);
    setActiveEndpointGeneration(generation);
    setExplicitEndpointRepoConnected(false);
    setShowRemoteSetupDialog(false);
    void refreshSavedRemoteRepos(endpoint.id, generation);
  };

  const terminalPaneRef = useRef<WorkspaceTerminalPaneHandle>(null);

  const { addToast } = useToast();
  useAutoUpdate({
    autoCheck: import.meta.env.MODE !== "test",
    listenMenu: import.meta.env.MODE !== "test",
  });
  const handleReturnToDashboard = () => {
    // Navigate to main repo ShowWorkspace > Code
    setSelectedWorkspace(null);
    setActiveSessionId(null);
  };

  const openSettings = (tab?: string) => {
    void tab;
    if (viewMode !== "settings") {
      previousViewModeRef.current = viewMode;
    }
    setViewMode("settings");
  };

  const closeSettings = () => {
    setViewMode(previousViewModeRef.current);
  };

  const openArtifacts = () => {
    if (viewMode !== "artifacts") {
      previousViewModeRef.current = viewMode;
    }
    setViewMode("artifacts");
    navigate(artifactsPath());
  };

  const closeArtifacts = () => {
    setViewMode(previousViewModeRef.current);
    navigate("/", { replace: true });
  };

  const openGitHub = () => {
    if (viewMode !== "github") {
      previousViewModeRef.current = viewMode;
    }
    setViewMode("github");
    navigate(githubListPath("issues"));
  };

  const openLinear = () => {
    if (viewMode !== "linear") {
      previousViewModeRef.current = viewMode;
    }
    setViewMode("linear");
    navigate(LINEAR_BASE_PATH);
  };

  const openGitHubPr = (prNumber: number, prState: string) => {
    if (viewMode !== "github") {
      previousViewModeRef.current = viewMode;
    }
    setViewMode("github");
    navigate(githubDetailPath("prs", prNumber, stateFilterForPrState(prState)));
  };

  // Browser back/forward can pop the URL out of the GitHub section (e.g. the
  // user opened it via the sidebar, then hit Back) without going through
  // openGitHub/openSettings, so mirror that into viewMode here.
  useEffect(() => {
    if (viewMode === "github" && !location.startsWith(GITHUB_BASE_PATH)) {
      setViewMode(previousViewModeRef.current);
    }
    if (viewMode === "artifacts" && !location.startsWith(ARTIFACTS_BASE_PATH)) {
      setViewMode(previousViewModeRef.current);
    }
    if (viewMode === "linear" && !location.startsWith(LINEAR_BASE_PATH)) {
      setViewMode(previousViewModeRef.current);
    }
    if (location.startsWith(ARTIFACTS_BASE_PATH) && viewMode !== "artifacts") {
      if (viewMode !== "github") {
        previousViewModeRef.current = viewMode;
      }
      setViewMode("artifacts");
    }
    if (location.startsWith(LINEAR_BASE_PATH) && viewMode !== "linear") {
      if (viewMode !== "github" && viewMode !== "artifacts") {
        previousViewModeRef.current = viewMode;
      }
      setViewMode("linear");
    }
  }, [location, viewMode]);

  // The reverse also happens: leaving "github" through a non-URL action (e.g.
  // clicking a workspace in the sidebar) should clear the now-stale
  // /github URL so Back/Forward doesn't get stuck pointing at a view that's
  // no longer showing.
  const previousViewModeForUrlRef = useRef<ViewMode>(viewMode);
  useEffect(() => {
    const leftGitHub =
      previousViewModeForUrlRef.current === "github" && viewMode !== "github";
    const leftArtifacts =
      previousViewModeForUrlRef.current === "artifacts" &&
      viewMode !== "artifacts";
    const leftLinear =
      previousViewModeForUrlRef.current === "linear" && viewMode !== "linear";
    previousViewModeForUrlRef.current = viewMode;
    if (leftGitHub && location.startsWith(GITHUB_BASE_PATH)) {
      navigate("/", { replace: true });
    }
    if (leftArtifacts && location.startsWith(ARTIFACTS_BASE_PATH)) {
      navigate("/", { replace: true });
    }
    if (leftLinear && location.startsWith(LINEAR_BASE_PATH)) {
      navigate("/", { replace: true });
    }
  }, [viewMode, location, navigate]);

  const handleOpenMergePreview = () => {
    if (selectedWorkspace) {
      setMergeWorkspace(selectedWorkspace);
      setViewMode("merge-preview");
    }
  };

  const { data: repoBranch } = useSWR(
    queryRepoKey ? ["repo-branch", queryRepoKey] : null,
    () => getRepoCurrentBranch(dataRepoPath),
  );
  const { data: repoDefaultBranch } = useSWR(
    queryRepoKey ? ["repo-default-branch", queryRepoKey] : null,
    () => getRepoDefaultBranch(dataRepoPath),
  );

  useEffect(() => {
    if (!dataRepoPath) return;
    if (!repoBranch) return;
    setCurrentBranch(repoBranch.current_branch);
    setHomeRepoDisplayRef(repoBranch.display_ref);
  }, [dataRepoPath, repoBranch]);

  const effectiveDefaultBranch = currentBranch || repoDefaultBranch || "main";

  const handleCreateStackedWorkspace = () => {
    if (!dataRepoPath) return;

    if (selectedWorkspace) {
      setUnifiedDialogDefaults({
        targetBranch: selectedWorkspace.branch_name,
        sourceWorkspace: selectedWorkspace,
      });
    } else if (effectiveDefaultBranch) {
      setUnifiedDialogDefaults({
        targetBranch: effectiveDefaultBranch,
        sourceWorkspace: null,
      });
    } else {
      addToast({
        title: "Cannot create stacked workspace",
        description: "No parent branch available",
        type: "error",
      });
    }
  };

  // Keyboard shortcuts
  useKeyboardShortcut("n", true, () => {
    setUnifiedDialogDefaults({});
  });

  useKeyboardShortcut(
    "n",
    true,
    () => {
      handleCreateStackedWorkspace();
    },
    [selectedWorkspace, effectiveDefaultBranch],
    { shift: true },
  );

  useKeyboardShortcut("k", true, () => {
    setShowCommandPalette(true);
  });

  useKeyboardShortcut("p", true, () => {
    setShowFilePicker(true);
  });

  // "?": show keyboard shortcut reference (Shift+/ on US keyboards)
  useKeyboardShortcut(
    "?",
    false,
    () => {
      setShowKeyboardShortcuts((open) => !open);
    },
    [],
    { ignoreShift: true },
  );

  useKeyboardShortcut(
    "Escape",
    false,
    () => {
      if (showTerminalMissionControl) {
        setShowTerminalMissionControl(false);
        return;
      }
      if (unifiedDialogDefaults) setUnifiedDialogDefaults(null);
      if (showCommandPalette) setShowCommandPalette(false);
      if (showFilePicker) setShowFilePicker(false);
      setShowKeyboardShortcuts(false);
    },
    [
      showTerminalMissionControl,
      unifiedDialogDefaults,
      showCommandPalette,
      showFilePicker,
    ],
  );

  useTwoFingerSwipe({
    onSwipeUp: () => setShowTerminalMissionControl(true),
    onSwipeDown: () => setShowTerminalMissionControl(false),
  });

  useSWR(
    repoPath && !isRemoteActive ? ["init-repo", repoPath] : null,
    async () => {
      try {
        await initRepo(repoPath);
      } catch (e) {
        console.error("Failed to init repo:", e);
      }
      await setWindowRepoPath(repoPath);
      return true;
    },
  );

  useEffect(() => {
    if (!dataRepoPath) {
      setCurrentBranch(null);
      setHomeRepoDisplayRef(null);
    }
  }, [dataRepoPath]);

  const {
    data: availableBranches = [],
    isValidating: branchesLoading,
    mutate: loadAvailableBranches,
  } = useSWR<BranchListItem[]>(
    dataRepoPath ? ["repo-branches", queryRepoKey] : null,
    async () => {
      const jjBranches = await listRepoBranches(dataRepoPath);
      return jjBranches.map((branch) => ({
        name: branch.name,
        fullName: branch.name,
        isCurrent: branch.is_current,
      }));
    },
    {
      revalidateOnMount: false,
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 5 * 60 * 1000,
    },
  );

  const handleLoadAvailableBranches = () => {
    if (!dataRepoPath) return;
    void loadAvailableBranches();
  };

  // Manage file watcher lifecycle for selected workspace
  // useEffect(() => {
  // 	if (viewMode !== "show-workspace") return;
  // 	if (showWorkspaceActiveTab !== "changes") return;
  // 	if (!selectedWorkspace) return;

  // 	const workspaceId = selectedWorkspace.id;
  // 	const workspacePath = getFullWorkspacePath(selectedWorkspace);

  // 	// startFileWatcher(workspaceId, workspacePath).catch((err) => {
  // 	// 	console.error("Failed to start file watcher:", err);
  // 	// });

  // 	// // Stop watching when workspace changes or component unmounts
  // 	// return () => {
  // 	// 	stopFileWatcher(workspaceId, workspacePath).catch((err) => {
  // 	// 		console.error("Failed to stop file watcher:", err);
  // 	// 	});
  // 	// };
  // }, [
  // 	viewMode,
  // 	showWorkspaceActiveTab,
  // 	selectedWorkspace?.id,
  // 	selectedWorkspace?.repo_path,
  // 	selectedWorkspace?.workspace_path,
  // ]);

  const { data: sessions = [] } = useSWR(
    queryRepoKey ? ["sessions", queryRepoKey] : null,
    () => getSessions(dataRepoPath).catch(() => []),
    { refreshInterval: pollMs(30000) },
  );

  const { data: workspaces = [] } = useSWR(
    queryRepoKey ? ["workspaces", queryRepoKey] : null,
    () => getWorkspaces(dataRepoPath),
    { refreshInterval: pollMs(10000) },
  );

  // `workspaces` is refetched (e.g. after a push, or on its 10s interval) and
  // returns fresh object references every time, but `selectedWorkspace` is a
  // point-in-time snapshot. Without this, fields like `not_on_remote` on the
  // currently open workspace go stale until the user re-selects it (e.g. the
  // "Push to remote" button would keep showing after a successful push).
  // Compare by value, not reference, so this only re-renders when the
  // workspace's data actually changed.
  useEffect(() => {
    setSelectedWorkspace((current) => {
      if (!current) return current;
      const updated = workspaces.find((w) => w.id === current.id);
      if (!updated || JSON.stringify(updated) === JSON.stringify(current)) {
        return current;
      }
      return updated;
    });
  }, [workspaces]);

  const { data: workspaceStatuses = [] } = useSWR(
    queryRepoKey ? ["workspace-statuses", queryRepoKey] : null,
    () => listWorkspaceStatuses(dataRepoPath),
    { refreshInterval: pollMs(10000) },
  );

  const visibleWorkspaces = (() => {
    if (workspaceStatuses.length === 0) {
      return workspaces;
    }
    return flattenWorkspaceTree(buildWorkspaceTree(workspaceStatuses)).map(
      (node) => node.status.current,
    );
  })();

  // Note: Git cache preloader removed since we're using JJ now

  const deleteWorkspaceMutation = useMutation({
    mutationFn: async (workspace: Workspace) => {
      await deleteWorkspace(workspace.repo_path, workspace.id);
    },
    onSuccess: (_data, workspace) => {
      terminalPaneRef.current?.closeTerminalsForWorkspace(
        getFullWorkspacePath(workspace),
      );
      void invalidateQueries(["workspaces", queryRepoKey]);
      invalidateQueries(["workspace-statuses", queryRepoKey]);
      handleReturnToDashboard(); // Navigate to dashboard & clear selected workspace
      addToast({
        title: "Workspace Archived",
        description: "Workspace has been archived successfully",
        type: "success",
      });
    },
    onError: (error) => {
      addToast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    },
  });

  const archiveWorkspaceMutation = useMutation({
    mutationFn: async (workspace: Workspace) => {
      await archiveWorkspace(workspace.repo_path, workspace.id);
    },
    onSuccess: (_data, workspace) => {
      terminalPaneRef.current?.closeTerminalsForWorkspace(
        getFullWorkspacePath(workspace),
      );
      void invalidateQueries(["workspaces", queryRepoKey]);
      invalidateQueries(["workspace-statuses", queryRepoKey]);
      handleReturnToDashboard();
      addToast({
        title: "Workspace Archived",
        description: "Workspace directory removed; record kept",
        type: "success",
      });
    },
    onError: (error) => {
      addToast({
        title: "Archive Failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    },
  });

  const openRepositoryAtPath = (selected: string) =>
    openRepositoryAtPathShared(selected, {
      addToast,
      onOpened: (path) => {
        setRepoPath(path);
        setSelectedWorkspace(null);
        setActiveSessionId(null);
        setSessionSelectedFile(null);
      },
    });

  const handleOpenRepository = async () => {
    const selected = await selectFolder();
    if (!selected) return;
    await openRepositoryAtPath(selected);
  };

  const handleOpenRepositoryInNewWindow = async () => {
    const selected = await selectFolder();
    if (!selected) return;
    const windowLabel = `treq-repo-${Date.now()}-${Math.floor(
      Math.random() * 1000,
    )}`;
    const repoName =
      selected.split("/").pop() || selected.split("\\").pop() || selected;
    new WebviewWindow(windowLabel, {
      url: `index.html?repo=${encodeURIComponent(selected)}`,
      title: `Treq - ${repoName}`,
      width: 1400,
      height: 900,
    });
  };

  // Restore the last-opened remote SSH repository only after reconnect and
  // trust validation. A stored blob or descriptor is not enough on its own.
  useEffect(() => {
    if (!remoteSshEnabled || repoPath) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const id = await getSetting(LAST_OPENED_REMOTE_REPO_ID_KEY).catch(
        () => null,
      );
      if (!id || cancelled) return;
      const descriptor = await getSavedRemoteRepository(id);
      if (!descriptor || cancelled) return;

      const userManaged = (await listUserManagedEndpoints()).find(
        (endpoint) => endpoint.id === descriptor.endpoint_id,
      );
      let endpoint: SshEndpoint | null = userManaged
        ? sshEndpointFromUserManaged(userManaged)
        : null;
      let generation = descriptor.endpoint_generation;
      if (!endpoint) {
        const status = await getInstanceStatus().catch(() => null);
        const { endpoint: statusEndpoint, instance } = status ?? {};
        if (statusEndpoint?.id === descriptor.endpoint_id) {
          endpoint = statusEndpoint;
          generation = generationFromEndpoint(
            statusEndpoint,
            instance?.generation ?? descriptor.endpoint_generation,
          );
          if (!cancelled && status) setInstanceStatus(status);
        }
      }
      if (!endpoint || cancelled) return;
      const activeEndpoint = endpoint;

      const result = await restoreSavedRemoteRepository({
        descriptor,
        currentGeneration: generation,
        explicitGenerationTransition: false,
        reconnect: async () => {
          try {
            await dispatchOverSsh(activeEndpoint, {
              kind: "ProbeRepo",
              repo: descriptor.canonical_remote_path,
            });
            return true;
          } catch {
            return false;
          }
        },
        validateHostKey: async () =>
          activeEndpoint.host_keys.some(
            (key) => key.fingerprint_sha256.length > 0,
          ),
        inspect: (canonicalPath) =>
          dispatchOverSsh<RepositoryInspection>(activeEndpoint, {
            kind: "InspectRepository",
            repo: canonicalPath,
          }),
      });
      if (cancelled) return;
      if (!result.ok) {
        setActiveRemoteRepo(null);
        setExplicitEndpointRepoConnected(false);
        return;
      }
      setActiveSshEndpoint(activeEndpoint);
      setActiveEndpointGeneration(result.descriptor.endpoint_generation);
      setSelectedSavedRepoId(result.descriptor.id);
      setExplicitEndpointRepoPath(result.descriptor.canonical_remote_path);
      setExplicitEndpointRepoConnected(true);
      await refreshSavedRemoteRepos(
        result.descriptor.endpoint_id,
        result.descriptor.endpoint_generation,
      );
      const connectedRepo = connectedRepoFromDescriptor(
        result.descriptor,
        activeEndpoint,
        result.inspection,
      );
      await setSetting("last_opened_remote_repo", JSON.stringify(connectedRepo));
      if (!cancelled) setActiveRemoteRepo(connectedRepo);
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPath, remoteSshEnabled]);

  const rememberRemoteHost = async (host: string) => {
    const raw = await getSetting("remote_ssh_recent_hosts").catch(() => null);
    const existing: string[] = raw ? JSON.parse(raw) : [];
    const next = [host, ...existing.filter((h) => h !== host)].slice(0, 5);
    await setSetting("remote_ssh_recent_hosts", JSON.stringify(next));
  };

  const handleOpenRemoteSsh = async () => {
    const configuredHosts = await listSshHosts().catch(() => []);
    const recentRaw = await getSetting("remote_ssh_recent_hosts").catch(
      () => null,
    );
    const recentHosts: string[] = recentRaw ? JSON.parse(recentRaw) : [];
    setRemoteSshHosts([
      ...new Set([...recentHosts, ...configuredHosts.map((h) => h.alias)]),
    ]);
    setRemoteSshHost(recentHosts[0] ?? configuredHosts[0]?.alias ?? "");
    setRemoteSshPath("~/src/project");
    setRemoteSshRepoUrl("");
    setRemoteSshNeedsClone(false);
    setRemoteSshFingerprint("");
    setRemoteSshStage("");
    setShowRemoteSshDialog(true);
  };

  const handleSubmitRemoteSsh = async () => {
    const host = remoteSshHost.trim();
    const remotePath = remoteSshPath.trim();
    const repoUrl = remoteSshRepoUrl.trim();
    const fingerprint = remoteSshFingerprint.trim();
    if (!host || !remotePath || !fingerprint) {
      addToast({
        title: "Remote SSH details required",
        description:
          "Enter an SSH host alias, remote directory, and the expected host-key fingerprint.",
        type: "error",
      });
      return;
    }

    setRemoteSshSubmitting(true);
    try {
      setRemoteSshStage("Resolving SSH alias and pinning host trust...");
      // Trust is explicit and pinned here, not inferred from ~/.ssh/known_hosts:
      // the alias is resolved to hostname/port/user, then paired with the
      // fingerprint the user just supplied to build a native SshEndpoint whose
      // HostKeyVerifier enforces exactly that fingerprint (never a system ssh
      // subprocess, never StrictHostKeyChecking=no).
      const identities = await listLocalSshIdentities().catch(() => []);
      const endpoint = await buildExplicitAliasSshEndpoint({
        endpointId: `alias:${host}`,
        alias: host,
        expectedFingerprint: fingerprint,
        hostKeyAlgorithm: "unknown",
        keyReference: identities[0]?.reference ?? "id_ed25519",
      });

      setRemoteSshStage("Inspecting repository...");
      const probe = await remoteProbeRepoOverSsh(endpoint, remotePath);
      let remoteRepo = probe.is_repo
        ? await remoteOpenRepoOverSsh(endpoint, remotePath)
        : null;

      if (!remoteRepo) {
        if (!repoUrl) {
          setRemoteSshNeedsClone(true);
          setRemoteSshStage("Repository not found. Enter a Git URL to clone.");
          return;
        }
        setRemoteSshStage("Cloning and inspecting repository...");
        remoteRepo = await remoteCloneRepoOverSsh(
          endpoint,
          repoUrl,
          remotePath,
        );
      }

      await rememberRemoteHost(host);
      await setSetting("last_opened_remote_repo", JSON.stringify(remoteRepo));
      setActiveRemoteRepo(remoteRepo);
      setShowRemoteSshDialog(false);
      addToast({
        title: "Remote SSH repository ready",
        description: `${remoteRepo.display_name} is ready for SSH terminal sessions.`,
        type: "success",
      });
    } catch (error) {
      addToast({
        title: "Remote SSH failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setRemoteSshSubmitting(false);
      setRemoteSshStage("");
    }
  };

  // Consolidate all Tauri event listeners
  useEffect(() => {
    const listeners = [
      // Git config init error handler
      // listen<{ repo_path: string; error: string }>(
      //   "git-config-init-error",
      //   (event) => {
      //     const { repo_path, error } = event.payload;
      //     if (repoPath && repo_path === repoPath) {
      //       addToast({
      //         title: "Git configuration warning",
      //         description: `Could not configure automatic remote tracking: ${error}`,
      //         type: "warning",
      //       });
      //     }
      //   }
      // ),
      // Navigate to settings
      listen("navigate-to-settings", () => {
        openSettings();
      }),
      // Menu open repository - path is resolved natively before this fires
      listen<string>("menu-repository-path-selected", (event) => {
        void openRepositoryAtPath(event.payload);
      }),
      // Menu open via SSH
      listen("menu-open-ssh", () => {
        if (!useFeaturePreviewStore.getState().flags.remoteSsh) return;
        void handleOpenRemoteSetup();
      }),
      // Menu factory reset
      listen("menu-factory-reset", async () => {
        const confirmed = await ask(
          "Clear the saved repository path and return to the start screen?",
          {
            title: "Factory Reset",
            kind: "warning",
          },
        );
        if (!confirmed) return;

        await setSetting("last_opened_repo_path", "");
        await setWindowRepoPath("");
        setRepoPath("");
        setSelectedWorkspace(null);
        setActiveSessionId(null);
        setSessionSelectedFile(null);
        void clearSWRCache();

        addToast({
          title: "Factory Reset Complete",
          description: "Repository path cleared.",
          type: "success",
        });
      }),
      listen("menu-open-in-new-window-invalid", () => {
        addToast({
          title: "Not a Git Repository",
          description: "Please select a folder that contains a git repository.",
          type: "error",
        });
      }),
      // Developer menu force rebase for current workspace
      listen("menu-force-rebase-workspace", async () => {
        if (!repoPath || !selectedWorkspace) {
          addToast({
            title: "No workspace selected",
            description: "Select a workspace first, then force rebase.",
            type: "warning",
          });
          return;
        }

        const defaultBranch =
          selectedWorkspace.target_branch || effectiveDefaultBranch;
        try {
          const result = await checkAndRebaseWorkspaces(
            repoPath,
            selectedWorkspace.id,
            defaultBranch,
            true,
          );

          void invalidateQueries(["workspaces", queryRepoKey]);
          invalidateQueries(["workspace-statuses", queryRepoKey]);

          addToast({
            title: result.success
              ? "Force rebase complete"
              : "Force rebase completed with errors",
            description:
              result.message || "Workspace subtree force rebase finished.",
            type: result.success ? "success" : "warning",
          });
        } catch (error) {
          addToast({
            title: "Force rebase failed",
            description: error instanceof Error ? error.message : String(error),
            type: "error",
          });
        }
      }),
    ];

    return () => {
      Promise.all(listeners).then((unlistenFns) => {
        unlistenFns.forEach((fn) => fn());
      });
    };
  }, [
    repoPath,
    selectedWorkspace,
    effectiveDefaultBranch,
    addToast,
    deleteWorkspaceMutation,
    handleOpenRepository,
    openSettings,
  ]);

  // Note: Git merge functionality removed - using JJ now

  // Helper to create or get session
  const getOrCreateSession = async (
    workspaceId: number | null,
    options?: {
      workspaceBranchName?: string;
      forceNew?: boolean;
      name?: string;
      agent?: "claude" | "codex" | "cursor";
    },
  ): Promise<number> => {
    const sessions = await getSessions(repoPath);
    if (!options?.forceNew) {
      const existing = sessions.find((s) => s.workspace_id === workspaceId);
      if (existing) {
        await updateSessionAccess(repoPath, existing.id);
        return existing.id;
      }
    }

    const scopedSessions = sessions.filter(
      (s) => s.workspace_id === workspaceId,
    );
    const index = scopedSessions.length + 1;
    let name = options?.name;
    if (!name) {
      const agentLabel =
        options?.agent === "codex"
          ? "Codex"
          : options?.agent === "cursor"
            ? "Cursor"
            : "Claude";
      name = `${agentLabel} ${index}`;
    }

    const sessionId = await createSession(repoPath, workspaceId, name);

    // Apply default model from settings (repo-level overrides application-level)
    try {
      const repoDefaultModel = await getRepoSetting(repoPath, "default_model");
      const appDefaultModel = await getSetting("default_model");
      const defaultModel = repoDefaultModel || appDefaultModel;

      if (defaultModel) {
        await setSessionModel(repoPath, sessionId, defaultModel);
      }
    } catch (error) {
      console.warn("Failed to set default model for session:", error);
    }

    void invalidateQueries(["sessions"]);
    return sessionId;
  };

  const handleOpenSession = async (
    workspace: Workspace | null,
    options?: SessionOpenOptions,
  ) => {
    setSelectedWorkspace(workspace);
    setSessionSelectedFile(options?.selectedFilePath ?? null);
  };

  const handleSessionCreated = (sessionData: {
    sessionId: number;
    workspaceId?: number | null;
    workspacePath?: string | null;
    pendingPrompt?: string;
    permissionMode?: "plan" | "acceptEdits";
    agent?: "claude" | "codex" | "cursor";
  }) => {
    void invalidateQueries(["sessions"]);
    setActiveSessionId(sessionData.sessionId);
    if (
      sessionData.pendingPrompt ||
      sessionData.permissionMode ||
      sessionData.agent ||
      sessionData.workspacePath
    ) {
      setPendingSessionData((prev) => {
        const next = new Map(prev);
        next.set(sessionData.sessionId, {
          pendingPrompt: sessionData.pendingPrompt,
          permissionMode: sessionData.permissionMode,
          agent: sessionData.agent,
          workspacePath: sessionData.workspacePath,
        });
        return next;
      });
    }
    if (sessionData.pendingPrompt) {
      addPromptHistory(
        repoPath,
        sessionData.workspaceId ?? null,
        sessionData.sessionId,
        sessionData.pendingPrompt,
        sessionData.agent,
      )
        .then(() => {
          void invalidateQueries(["prompt-history"]);
          invalidateQueries(["workspace-starting-prompt"]);
        })
        .catch((error) => {
          console.error("Failed to record prompt history:", error);
        });
    }
  };

  const handleViewFullPrompt = (promptId: number) => {
    setPromptHistoryFocusId(promptId);
    setShowPromptHistory(true);
  };

  const handlePromptHistoryOpenChange = (open: boolean) => {
    setShowPromptHistory(open);
    if (!open) setPromptHistoryFocusId(null);
  };

  const handleRunPrompt = (prompt: string, workspaceId: number | null) => {
    setShowPromptHistory(false);
    setPromptHistoryFocusId(null);
    setRunPromptRequest({ prompt, workspaceId });
    setShowAgentPromptDialog(true);
  };

  const handleStartPromptFromIssue = (issue: GitHubIssueAttachment) => {
    setRunPromptRequest({
      workspaceId: null,
      githubIssue: issue,
    });
    setShowAgentPromptDialog(true);
  };

  const handleStartPromptFromLinearIssue = (issue: LinearIssueAttachment) => {
    setRunPromptRequest({ workspaceId: null, linearIssue: issue });
    setShowAgentPromptDialog(true);
  };

  const handleAgentPromptDialogOpenChange = (open: boolean) => {
    setShowAgentPromptDialog(open);
    if (!open) setRunPromptRequest(null);
  };

  const handleStartDefaultAgent = async () => {
    const configuredAgent =
      (await getRepoSetting(repoPath, "default_agent")) ||
      (await getSetting("default_agent"));
    const agent =
      configuredAgent === "codex" || configuredAgent === "cursor"
        ? configuredAgent
        : "claude";
    const sessionId = await getOrCreateSession(selectedWorkspace?.id ?? null, {
      workspaceBranchName:
        selectedWorkspace?.branch_name ?? effectiveDefaultBranch,
      forceNew: true,
      agent,
    });
    handleSessionCreated({ sessionId, agent });
  };

  // Navigate to workspace without creating an agent session
  const handleSelectWorkspace = (workspace: Workspace | null) => {
    const next = workspace ?? null;
    setSelectedWorkspace(next);
    setViewMode("show-workspace");
    if (repoPath) {
      void invalidateReviewChangeCount(queryRepoKey, next?.id ?? null);
    }
  };

  const { moveWorkspace } = useWorkspaceHierarchy({
    repoPath: dataRepoPath,
    workspaces,
    defaultBranch: effectiveDefaultBranch,
  });

  const handleAddAfter = (workspace: Workspace) => {
    setUnifiedDialogDefaults({
      targetBranch: workspace.branch_name,
      sourceWorkspace: workspace,
    });
  };

  const handleAddBefore = (workspace: Workspace) => {
    setUnifiedDialogDefaults({
      targetBranch: workspace.branch_name,
      sourceWorkspace: workspace,
    });
  };

  const handleMoveWorkspace = async (
    workspace: Workspace,
    targetBranch: string | null,
  ) => {
    try {
      await moveWorkspace(workspace, targetBranch);
    } catch (error) {
      addToast({
        title: "Failed to move workspace",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
  };

  const handleDropChangeFiles = (request: ChangeFilesMoveRequest) => {
    if (
      request.files.length === 0 ||
      request.sourceBranch === request.destinationBranch
    ) {
      return;
    }
    setPendingChangeMove(request);
  };

  const handleConfirmChangeMove = async () => {
    if (!pendingChangeMove || !repoPath) return;
    setChangeMovePending(true);
    try {
      await moveWorkspaceChanges(
        repoPath,
        pendingChangeMove.sourceBranch,
        pendingChangeMove.destinationBranch,
        {
          files: pendingChangeMove.files,
          hunks: [],
          commits: [],
        },
      );
      addToast({
        title: "Files moved",
        description: `Moved ${pendingChangeMove.files.length} file(s) to ${pendingChangeMove.destinationLabel}`,
        type: "success",
      });
      setPendingChangeMove(null);
      await invalidateQueries(["workspaces", queryRepoKey]);
      await invalidateQueries(["workspace-statuses", queryRepoKey]);
      await invalidateReviewChangeCount(
        repoPath,
        selectedWorkspace?.id ?? null,
      );
      dispatchRefreshWorkspaceChanges();
    } catch (error) {
      addToast({
        title: "Failed to move files",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setChangeMovePending(false);
    }
  };

  const handleSelectStack = (workspaceIds: Set<number>) => {
    setSelectedWorkspaceIds(workspaceIds);
  };

  const handleCreateSessionFromSidebar = async (
    workspaceId: number | null,
    agent?: "claude" | "codex" | "cursor",
  ) => {
    if (!remoteCaps.agentPty.supported) {
      addToast({
        title: "Agent terminal unavailable",
        description: remoteCaps.agentPty.reason,
        type: "warning",
      });
      return;
    }
    const workspace = workspaceId
      ? (workspaces.find((w) => w.id === workspaceId) ?? null)
      : null;

    // When no agent is specified explicitly, resolve from settings (repo-level
    // overrides app-level, both fall back to "claude").
    const resolvedAgent = await (async (): Promise<
      "claude" | "codex" | "cursor" | undefined
    > => {
      if (agent) return agent;
      let repoDefault: string | null = null;
      let appDefault: string | null = null;
      try {
        repoDefault = await getRepoSetting(repoPath, "default_agent");
      } catch {
        // repo may not be initialized yet; fall through to app-level
      }
      try {
        appDefault = await getSetting("default_agent");
      } catch {
        // ignore
      }
      const defaultAgent = repoDefault || appDefault;
      if (defaultAgent === "codex" || defaultAgent === "cursor") {
        return defaultAgent;
      }
      return undefined;
    })();

    const sessionId = await getOrCreateSession(workspaceId, {
      forceNew: true,
      agent: resolvedAgent,
    });
    void invalidateQueries(["sessions"]);
    setActiveSessionId(sessionId);
    setSelectedWorkspace(workspace);
    if (resolvedAgent) {
      setPendingSessionData((prev) => {
        const next = new Map(prev);
        next.set(sessionId, { agent: resolvedAgent! });
        return next;
      });
    }
  };

  const remoteConnectionState = cutoffReason
    ? "cutoff"
    : connectionStateFromInstanceState(
        instanceStatus?.instance?.status,
        Boolean(activeSshEndpoint) || Boolean(activeRemoteRepo),
      );

  const handleRefreshRemote = () => {
    if (cutoffReason) return;
    invalidateRemoteRepositoryData();
    void refreshInstanceStatus();
  };

  const handleStartShellFromSidebar = (workspace: Workspace) => {
    if (!remoteCaps.shell.supported) {
      addToast({
        title: "Shell unavailable",
        description: remoteCaps.shell.reason,
        type: "warning",
      });
      return;
    }
    setSelectedWorkspace(workspace);
    terminalPaneRef.current?.createShellSession(
      getFullWorkspacePath(workspace),
    );
  };

  const handleStartHomeShellFromSidebar = () => {
    if (!remoteCaps.shell.supported) {
      addToast({
        title: "Shell unavailable",
        description: remoteCaps.shell.reason,
        type: "warning",
      });
      return;
    }
    setSelectedWorkspace(null);
    if (dataRepoPath) {
      terminalPaneRef.current?.createShellSession(dataRepoPath);
    }
  };

  const handleStackHomeFromSidebar = () => {
    if (!dataRepoPath) return;
    if (!effectiveDefaultBranch) {
      addToast({
        title: "Cannot create stacked workspace",
        description: "No parent branch available",
        type: "error",
      });
      return;
    }
    setUnifiedDialogDefaults({
      targetBranch: effectiveDefaultBranch,
      sourceWorkspace: null,
    });
  };

  // Full workspace path -> branch name, used to resolve shell terminal
  // branches for the sidebar's terminal sessions list.
  const workspaceBranchByPath = (() => {
    const map = new Map<string, string>();
    for (const ws of workspaces) {
      map.set(getFullWorkspacePath(ws), ws.branch_name);
    }
    return map;
  })();

  const handleCreateAgentTerminalFromSidebar = () => {
    terminalPaneRef.current?.createAgentSession();
  };

  const handleCreateShellTerminalFromSidebar = () => {
    terminalPaneRef.current?.createShellSession();
  };

  const handleFocusTerminalSession = (id: string) => {
    terminalPaneRef.current?.focusTerminal(id);
  };

  const handleCloseTerminalSession = (id: string) => {
    terminalPaneRef.current?.closeTerminal(id);
  };

  const handleCloseIdleTerminalSessions = () => {
    terminalPaneRef.current?.closeIdleTerminals();
  };

  const handleCloseAllTerminalSessions = async () => {
    const confirmed = await ask(
      "Close all terminal sessions? This will stop all running agent and shell terminals.",
      { title: "Close All Terminals", kind: "warning" },
    );
    if (confirmed) {
      terminalPaneRef.current?.closeAllTerminals();
    }
  };

  const handleStartAgentRequest = async (request: AgentDeepLinkRequest) => {
    const workspace = findWorkspaceByBranch(workspaces, request.branch);
    if (!workspace) {
      addToast({
        title: "Workspace not found",
        description: `Branch '${request.branch}' is not available in this window.`,
        type: "error",
      });
      await acknowledgeAgentDispatch(
        request.requestId,
        "rejected",
        `Workspace branch '${request.branch}' was not found`,
      );
      return;
    }

    try {
      const sessionId = await getOrCreateSession(workspace.id, {
        forceNew: true,
        agent: request.agent,
      });
      setActiveSessionId(sessionId);
      setSelectedWorkspace(workspace);
      setViewMode("show-workspace");
      setPendingSessionData((prev) => {
        const next = new Map(prev);
        next.set(sessionId, {
          pendingPrompt: request.prompt,
          permissionMode: request.mode,
          agent: request.agent,
        });
        return next;
      });
      if (request.prompt) {
        addPromptHistory(
          repoPath,
          workspace.id,
          sessionId,
          request.prompt,
          request.agent,
        )
          .then(() => {
            void invalidateQueries(["prompt-history"]);
            invalidateQueries(["workspace-starting-prompt"]);
          })
          .catch((error) => {
            console.error("Failed to record prompt history:", error);
          });
      }
      markProcessedAgentRequest(request.requestId);
      await acknowledgeAgentDispatch(request.requestId, "accepted");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await acknowledgeAgentDispatch(request.requestId, "rejected", reason);
    }
  };
  const handleStartAgentRequestRef = useRef(handleStartAgentRequest);
  handleStartAgentRequestRef.current = handleStartAgentRequest;

  useEffect(() => {
    const setup = async () =>
      await listen<string[]>("deep-link-received", async (event) => {
        const requests = parseAgentDeepLinks(event.payload ?? []);
        await processAgentDeepLinkRequests(requests, {
          repoPath,
          workspacesLength: workspaces.length,
          onSameRepoRequest: (request) =>
            handleStartAgentRequestRef.current(request),
          deferRequest: (request) => {
            setDeferredAgentRequests((prev) => [...prev, request]);
          },
          openOtherRepoWindow: (request) => {
            const windowLabel = `treq-agent-${Date.now()}-${Math.floor(
              Math.random() * 1000,
            )}`;
            const newRepoName =
              request.repo.split("/").pop() ||
              request.repo.split("\\").pop() ||
              request.repo;
            new WebviewWindow(windowLabel, {
              url: `index.html?repo=${encodeURIComponent(request.repo)}`,
              title: `Treq - ${newRepoName}`,
              width: 1400,
              height: 900,
            });
          },
        });
      });

    const unlistenPromise = setup();
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [repoPath, workspaces.length]);

  useEffect(() => {
    if (!repoPath || workspaces.length === 0) return;
    const queued = popPendingAgentRequests(repoPath);
    if (queued.length === 0 && deferredAgentRequests.length === 0) return;
    const pending = [...queued, ...deferredAgentRequests];
    setDeferredAgentRequests([]);
    for (const request of pending) {
      if (isProcessedAgentRequest(request.requestId)) continue;
      void handleStartAgentRequestRef.current(request);
    }
  }, [deferredAgentRequests, repoPath, workspaces.length]);

  const handleWorkspaceMultiSelect = (
    workspace: Workspace | null,
    event: React.MouseEvent,
  ) => {
    // Handle clicking away to clear selection
    if (workspace === null) {
      setSelectedWorkspaceIds(new Set());
      lastSelectedWorkspaceIndexRef.current = null;
      return;
    }

    if (archivingWorkspaceIds.size > 0 || exitingWorkspaceIds.size > 0) {
      return;
    }

    const workspaceIndex = visibleWorkspaces.findIndex(
      (w) => w.id === workspace.id,
    );
    if (workspaceIndex === -1) return;

    const isMetaKey = event.metaKey || event.ctrlKey;
    const isShiftKey = event.shiftKey;

    if (isShiftKey && lastSelectedWorkspaceIndexRef.current !== null) {
      // Range selection
      const start = Math.min(
        lastSelectedWorkspaceIndexRef.current,
        workspaceIndex,
      );
      const end = Math.max(
        lastSelectedWorkspaceIndexRef.current,
        workspaceIndex,
      );
      const newSelection = new Set<number>();
      for (let i = start; i <= end; i++) {
        newSelection.add(visibleWorkspaces[i].id);
      }
      setSelectedWorkspaceIds(newSelection);
    } else if (isMetaKey) {
      // Toggle selection
      setSelectedWorkspaceIds((prev) => {
        const next = new Set(prev);
        if (next.has(workspace.id)) {
          next.delete(workspace.id);
        } else {
          next.add(workspace.id);
        }
        return next;
      });
      lastSelectedWorkspaceIndexRef.current = workspaceIndex;
    } else {
      // Regular click - clear multi-select, navigate to workspace
      setSelectedWorkspaceIds(new Set());
      lastSelectedWorkspaceIndexRef.current = workspaceIndex;
      handleSelectWorkspace(workspace);
    }
  };

  const handleBulkArchive = async () => {
    if (archivingWorkspaceIds.size > 0 || exitingWorkspaceIds.size > 0) {
      return;
    }
    const count = selectedWorkspaceIds.size;
    const workspacesToArchive = workspaces.filter((w) =>
      selectedWorkspaceIds.has(w.id),
    );
    const ids = new Set(workspacesToArchive.map((w) => w.id));
    setArchivingWorkspaceIds(ids);
    try {
      await Promise.all(
        workspacesToArchive.map((workspace) =>
          archiveWorkspace(workspace.repo_path, workspace.id),
        ),
      );
      for (const workspace of workspacesToArchive) {
        terminalPaneRef.current?.closeTerminalsForWorkspace(
          getFullWorkspacePath(workspace),
        );
      }
      setArchivingWorkspaceIds(new Set());
      setExitingWorkspaceIds(ids);
      addToast({
        title: `${count} Workspace${count > 1 ? "s" : ""} Archived`,
        description: `Successfully archived ${count} workspace${
          count > 1 ? "s" : ""
        }`,
        type: "success",
      });
      await new Promise((resolve) => setTimeout(resolve, 220));
      await invalidateQueries(["workspaces", queryRepoKey]);
      invalidateQueries(["workspace-statuses", queryRepoKey]);
      handleReturnToDashboard();
    } catch (error) {
      addToast({
        title: "Archive Failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
    setSelectedWorkspaceIds(new Set());
    setArchivingWorkspaceIds(new Set());
    setExitingWorkspaceIds(new Set());
  };

  const handleDelete = async (workspace: Workspace) => {
    const confirmed = await ask(`Delete workspace ${workspace.branch_name}?`, {
      title: "Delete Workspace",
      kind: "warning",
    });
    if (confirmed) {
      deleteWorkspaceMutation.mutate(workspace);
    }
  };

  const handleArchive = (workspace: Workspace) => {
    archiveWorkspaceMutation.mutate(workspace);
  };

  // Handle branch change after switching
  const handleBranchChanged = (branchName?: string) => {
    if (branchName) {
      setCurrentBranch(branchName);
      setHomeRepoDisplayRef(branchName);
    }
    void invalidateQueries(["repo-status", queryRepoKey]);
    void invalidateQueries(["repo-branch", queryRepoKey]);
    // Refresh workspace data
    void invalidateQueries(["workspaces", queryRepoKey]);
    invalidateQueries(["workspace-statuses", queryRepoKey]);
    void invalidateQueries(["workspace-review-change-count", repoPath]);
    dispatchRefreshWorkspaceChanges();
  };

  const isSessionView = viewMode === "session" || viewMode === "show-workspace";
  const showSidebar = true;
  const sidebarWidth = useSidebarWidthStore((s) => s.width);
  const sidebarWidthStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;

  const mainContentStyle = {
    width: showSidebar ? `calc(100vw - ${sidebarWidth}px)` : "100%",
  };

  // Build Claude sessions data for the terminal pane
  const claudeSessionsForPane = ((): ClaudeSessionData[] => {
    const workspaceMap = new Map(workspaces.map((ws) => [ws.id, ws]));

    return sessions.map((session) => {
      const sessionWorkspace = session.workspace_id
        ? (workspaceMap.get(session.workspace_id) ?? null)
        : null;
      const pending = pendingSessionData.get(session.id);
      return {
        sessionId: session.id,
        sessionName: session.name,
        ptySessionId: `session-${session.id}`,
        workspacePath:
          pending?.workspacePath ??
          (sessionWorkspace ? getFullWorkspacePath(sessionWorkspace) : null),
        repoPath: sessionWorkspace?.repo_path ?? repoPath,
        workspaceName: sessionWorkspace?.branch_name ?? null,
        ...(pending && {
          pendingPrompt: pending.pendingPrompt,
          permissionMode: pending.permissionMode,
          agent: pending.agent,
        }),
      };
    });
  })();

  const sessionLayerStyle: CSSProperties = {
    visibility: isSessionView ? "visible" : "hidden",
    zIndex: isSessionView ? 10 : 0,
    pointerEvents: isSessionView ? "auto" : "none",
  };

  const remoteSshDialog = (
    <Dialog open={showRemoteSshDialog} onOpenChange={setShowRemoteSshDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open via SSH</DialogTitle>
          <DialogDescription>
            Use an SSH host alias from your config and a remote repository path.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">SSH host</span>
            <Input
              value={remoteSshHost}
              onChange={(event) => setRemoteSshHost(event.target.value)}
              placeholder="my-server"
              list="remote-ssh-hosts"
            />
            <datalist id="remote-ssh-hosts">
              {remoteSshHosts.map((host) => (
                <option key={host} value={host} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1" htmlFor="remote-ssh-path">
            <span className="text-sm font-medium">Remote directory</span>
            <Input
              id="remote-ssh-path"
              value={remoteSshPath}
              onChange={(event) => setRemoteSshPath(event.target.value)}
              placeholder="~/src/project"
            />
          </label>
          {remoteSshNeedsClone && (
            <label
              className="flex flex-col gap-1"
              htmlFor="remote-ssh-repo-url"
            >
              <span className="text-sm font-medium">
                Git URL (repository not found remotely)
              </span>
              <Input
                id="remote-ssh-repo-url"
                value={remoteSshRepoUrl}
                onChange={(event) => setRemoteSshRepoUrl(event.target.value)}
                placeholder="git@github.com:org/repo.git"
              />
            </label>
          )}
          <label
            className="flex flex-col gap-1"
            htmlFor="remote-ssh-fingerprint"
          >
            <span className="text-sm font-medium">
              Expected host-key fingerprint
            </span>
            <Input
              id="remote-ssh-fingerprint"
              className="font-mono text-xs"
              value={remoteSshFingerprint}
              onChange={(event) => setRemoteSshFingerprint(event.target.value)}
              placeholder="SHA256:..."
            />
            <span className="text-xs text-muted-foreground">
              Treq pins this fingerprint and never infers trust from your local
              SSH configuration or known_hosts; a changed key is always
              rejected.
            </span>
          </label>
          {remoteSshStage && (
            <p className="text-sm text-muted-foreground">{remoteSshStage}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setShowRemoteSshDialog(false)}
            disabled={remoteSshSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmitRemoteSsh()}
            disabled={remoteSshSubmitting}
          >
            {remoteSshSubmitting ? "Connecting..." : "Open via SSH"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  const remoteSetupDialog = (
    <RemoteSetupDialog
      open={showRemoteSetupDialog}
      onOpenChange={setShowRemoteSetupDialog}
      regions={remoteRegions}
      sizePresets={remoteSizePresets}
      localKeyIdentities={localKeyIdentities}
      sshConfigAliasSuggestions={remoteSshHosts}
      instanceStatus={instanceStatus}
      provisioningStage={provisioningStage}
      provisioningError={provisioningError}
      onProvisionManaged={handleProvisionManaged}
      onWake={handleWakeManaged}
      onReprovision={handleReprovisionManaged}
      onDeleteInstance={handleDeleteManagedInstance}
      onRevokeKey={handleRevokeKey}
      onConnectManaged={handleConnectManaged}
      onRegisterUserManaged={handleRegisterUserManaged}
      onOpenManagedRepositories={handleOpenManagedRepositories}
    />
  );

  const explicitEndpointPathForm =
    activeSshEndpoint && !activeRemoteRepo && !dataRepoPath ? (
      <div className="flex flex-col gap-3 border-b px-4 py-3">
        {cutoffs[activeSshEndpoint.id] && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
            <p className="font-medium text-red-700 dark:text-red-300">
              Access blocked (
              {cutoffs[activeSshEndpoint.id].split("_").join(" ")})
            </p>
            <p className="mt-1 text-muted-foreground">
              This instance is cut off from further commands until you
              reauthenticate and obtain a new certificate.
            </p>
            <Button
              size="sm"
              className="mt-2"
              onClick={() => void handleReauthenticateManaged()}
            >
              Reauthenticate
            </Button>
          </div>
        )}
        {!explicitEndpointRepoConnected && !cutoffs[activeSshEndpoint.id] && (
          <RemoteRepositorySelector
            savedRepositories={savedRemoteRepos}
            selectedId={selectedSavedRepoId}
            path={explicitEndpointRepoPath}
            probe={explicitEndpointProbe}
            cloneUrl={explicitEndpointCloneUrl}
            confirmInit={confirmInitRemoteRepo}
            busy={remoteRepoBusy}
            error={explicitEndpointError}
            onSelectSaved={(id) => void handleSelectSavedRemoteRepo(id)}
            onPathChange={(next) => {
              setExplicitEndpointRepoPath(next);
              setSelectedSavedRepoId(null);
              setExplicitEndpointProbe(null);
              setExplicitEndpointRepoConnected(false);
            }}
            onProbe={() => void handleProbeExplicitEndpointRepo()}
            onCloneUrlChange={setExplicitEndpointCloneUrl}
            onConfirmInitChange={setConfirmInitRemoteRepo}
            onOpenExisting={() => void handleConnectExplicitEndpointRepo()}
            onClone={() => void handleCloneExplicitEndpointRepo()}
            onInit={() => void handleInitExplicitEndpointRepo()}
          />
        )}
      </div>
    ) : null;

  return (
    <ActiveRepositoryProvider repository={activeRepository}>
      {!dataRepoPath ? (
        <>
          <Onboarding
            onOpenRepo={handleOpenRepository}
            onOpenRemoteSsh={
              remoteSshEnabled ? handleOpenRemoteSetup : undefined
            }
          />
          {explicitEndpointPathForm}
          {remoteSetupDialog}
          {remoteSshDialog}
          <RemoteAmbiguousMutationDialog />
        </>
      ) : (
        <SidebarProvider
          className="relative h-screen bg-background"
          style={sidebarWidthStyle}
        >
          {cutoffReason && (
            <div
              data-testid="remote-cutoff-overlay"
              className="absolute inset-0 z-40 bg-background/40"
              aria-hidden
            />
          )}
          <WorkspaceSidebar
            repoPath={dataRepoPath}
            homeRepoDisplayRef={homeRepoDisplayRef}
            selectedWorkspaceId={selectedWorkspace?.id ?? null}
            selectedWorkspaceIds={selectedWorkspaceIds}
            archivingWorkspaceIds={archivingWorkspaceIds}
            exitingWorkspaceIds={exitingWorkspaceIds}
            onWorkspaceClick={(workspace) => handleSelectWorkspace(workspace)}
            onWorkspaceMultiSelect={handleWorkspaceMultiSelect}
            onBulkArchive={handleBulkArchive}
            onArchiveWorkspace={handleArchive}
            openSettings={openSettings}
            navigateToDashboard={handleReturnToDashboard}
            onOpenCommandPalette={() => setShowCommandPalette(true)}
            onOpenBranchSwitcher={() => setShowBranchSwitcher(true)}
            onAddBefore={handleAddBefore}
            onAddAfter={handleAddAfter}
            onMoveWorkspace={handleMoveWorkspace}
            onSelectStack={handleSelectStack}
            onStartAgent={(workspace) =>
              handleCreateSessionFromSidebar(workspace.id)
            }
            onStartShell={handleStartShellFromSidebar}
            onStartHomeAgent={() => handleCreateSessionFromSidebar(null)}
            onStartHomeShell={handleStartHomeShellFromSidebar}
            onStackHome={handleStackHomeFromSidebar}
            terminalSessions={terminalSessionSummaries}
            onFocusTerminalSession={handleFocusTerminalSession}
            onCloseTerminalSession={handleCloseTerminalSession}
            onCloseIdleTerminalSessions={handleCloseIdleTerminalSessions}
            onCloseAllTerminalSessions={handleCloseAllTerminalSessions}
            onCreateAgentTerminal={handleCreateAgentTerminalFromSidebar}
            onCreateShellTerminal={handleCreateShellTerminalFromSidebar}
            onDropChangeFiles={handleDropChangeFiles}
            onOpenGitHub={openGitHub}
            onOpenLinear={linearIntegrationEnabled ? openLinear : undefined}
            onOpenArtifacts={openArtifacts}
            currentPage={
              viewMode === "settings"
                ? "settings"
                : viewMode === "github"
                  ? "github"
                  : viewMode === "artifacts"
                    ? "artifacts"
                    : viewMode === "linear"
                      ? "linear"
                      : viewMode === "session" || viewMode === "show-workspace"
                        ? "session"
                        : undefined
            }
          />

          <SidebarInset
            className="flex-1 relative min-w-0"
            style={mainContentStyle}
          >
            {/* Sessions Layer - ALWAYS RENDERED ONCE */}
            <div
              className="absolute inset-0 flex flex-col workspace-terminal-container overflow-hidden"
              style={sessionLayerStyle}
            >
              {isRemoteActive && (
                <div className="relative z-50 shrink-0 border-b bg-background">
                  <div className="flex items-center justify-between px-4 py-1 text-xs text-muted-foreground">
                    <span>{activeRepository?.displayName}</span>
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={handleRefreshRemote}
                      disabled={Boolean(cutoffReason)}
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="px-4 pb-1.5">
                    <RemoteStatusBanner
                      state={remoteConnectionState}
                      detail={
                        cutoffReason
                          ? "Access is blocked until you reauthenticate."
                          : undefined
                      }
                      onRefresh={cutoffReason ? undefined : handleRefreshRemote}
                      onWake={() => void handleWakeManaged()}
                      onReconnect={() => void refreshInstanceStatus()}
                    />
                  </div>
                  <RemoteCapabilityNotice capabilities={remoteCaps} />
                </div>
              )}
              {/* Show workspace views take up remaining space */}
              {dataRepoPath && (
                <div className="flex-1 min-h-0 overflow-hidden relative">
                  <ErrorBoundary
                    fallbackTitle="Workspace error"
                    resetKeys={[selectedWorkspace?.id]}
                    onReset={handleReturnToDashboard}
                  >
                    <ShowWorkspace
                      repositoryPath={dataRepoPath}
                      workspace={selectedWorkspace}
                      onActiveTabChange={setShowWorkspaceActiveTab}
                      mainRepoBranch={effectiveDefaultBranch}
                      initialSelectedFile={sessionSelectedFile}
                      availableBranches={availableBranches}
                      branchesLoading={branchesLoading}
                      onLoadAvailableBranches={handleLoadAvailableBranches}
                      onDeleteWorkspace={handleDelete}
                      onOpenFilePicker={() => setShowFilePicker(true)}
                      onOpenMergePreview={handleOpenMergePreview}
                      onViewPrInApp={openGitHubPr}
                      onOpenBranchSwitcher={() => setShowBranchSwitcher(true)}
                      onCreateStackedWorkspace={handleCreateStackedWorkspace}
                      onNavigateToWorkspace={handleSelectWorkspace}
                      onMoveCommitToNewWorkspace={(commit, workspace) => {
                        const firstLine =
                          commit.description.split("\n")[0] || undefined;
                        setUnifiedDialogDefaults({
                          targetBranch: workspace?.branch_name,
                          sourceWorkspace: workspace ?? null,
                          preSelectedCommits: [commit.change_id],
                          description: firstLine,
                          activeTab: "commits",
                        });
                      }}
                      onMoveCommitToExistingWorkspace={(commit, workspace) => {
                        setUnifiedDialogDefaults({
                          targetBranch: workspace?.branch_name,
                          sourceWorkspace: workspace ?? null,
                          preSelectedCommits: [commit.change_id],
                          activeTab: "commits",
                        });
                        // Note: dialog will open in "move to existing" mode via defaults
                      }}
                      onCommitStashed={() => setShowStashModal(true)}
                      onMoveFilesToNewWorkspace={(files, workspace) => {
                        setUnifiedDialogDefaults({
                          targetBranch: workspace?.branch_name,
                          sourceWorkspace: workspace ?? null,
                          preSelectedFiles: files,
                          activeTab: "changes",
                        });
                      }}
                      onSessionCreated={handleSessionCreated}
                      onViewFullPrompt={handleViewFullPrompt}
                    />
                  </ErrorBoundary>
                </div>
              )}
              {/* Shared workspace terminal pane - always rendered to preserve state */}
              <WorkspaceTerminalPane
                ref={terminalPaneRef}
                key={queryRepoKey}
                workingDirectory={
                  selectedWorkspace
                    ? getFullWorkspacePath(selectedWorkspace)
                    : dataRepoPath
                }
                currentBranch={effectiveDefaultBranch}
                claudeSessions={claudeSessionsForPane}
                activeClaudeSessionId={isSessionView ? activeSessionId : null}
                workspaceBranchByPath={workspaceBranchByPath}
                onTerminalsChange={setTerminalSessionSummaries}
                onActiveSessionChange={(sessionId) => {
                  if (sessionId === null) {
                    setActiveSessionId(null);
                    return;
                  }
                  setActiveSessionId(sessionId);
                  // Find the session to determine view mode
                  const session = sessions.find((s) => s.id === sessionId);
                  if (session) {
                    setViewMode(
                      session.workspace_id ? "show-workspace" : "session",
                    );
                    if (session.workspace_id) {
                      const ws = workspaces.find(
                        (w) => w.id === session.workspace_id,
                      );
                      if (ws) setSelectedWorkspace(ws);
                    }
                  }
                }}
                onCloseSession={(sessionId) => {
                  if (activeSessionId === sessionId) {
                    setActiveSessionId(null);
                  }
                }}
                onCreateNewSession={(activeWorkspacePath, agent) => {
                  if (activeWorkspacePath) {
                    const ws = workspaces.find(
                      (w) => getFullWorkspacePath(w) === activeWorkspacePath,
                    );
                    handleCreateSessionFromSidebar(ws?.id ?? null, agent);
                  } else {
                    handleCreateSessionFromSidebar(
                      selectedWorkspace?.id ?? null,
                      agent,
                    );
                  }
                }}
                onNavigateToWorkspace={(workspaceKey, isMainRepo) => {
                  if (isMainRepo) {
                    handleSelectWorkspace(null);
                  } else {
                    const ws = workspaces.find(
                      (w) => w.workspace_path === workspaceKey,
                    );
                    if (ws) {
                      handleSelectWorkspace(ws);
                    }
                  }
                }}
              />
            </div>

            {/* Content Layer - Dashboard, Settings, Merge-Review, Workspace-Edit */}
            <div
              className="absolute inset-0 overflow-auto"
              style={{
                visibility: !isSessionView ? "visible" : "hidden",
                zIndex: !isSessionView ? 10 : 0,
                pointerEvents: !isSessionView ? "auto" : "none",
              }}
            >
              {/* Settings View */}
              {viewMode === "settings" && (
                <SettingsPage
                  repoPath={dataRepoPath}
                  onClose={closeSettings}
                  currentBranch={effectiveDefaultBranch}
                />
              )}

              {viewMode === "artifacts" && (
                <ArtifactsPage
                  repoPath={dataRepoPath}
                  onClose={closeArtifacts}
                />
              )}

              {/* GitHub Panel */}
              {viewMode === "github" && (
                <GitHubPanel
                  repoPath={dataRepoPath}
                  onOpenSettings={openSettings}
                  onStartPromptFromIssue={handleStartPromptFromIssue}
                  onOpenWorkspace={async (workspaceId) => {
                    await invalidateQueries(["workspaces", queryRepoKey]);
                    const updatedWorkspaces = await fetchAndCache(
                      ["workspaces", repoPath],
                      () => getWorkspaces(dataRepoPath),
                    );
                    const workspace = updatedWorkspaces.find(
                      (w) => w.id === workspaceId,
                    );
                    if (workspace) {
                      handleSelectWorkspace(workspace);
                    }
                  }}
                />
              )}

              {/* Linear Panel */}
              {viewMode === "linear" && linearIntegrationEnabled && (
                <LinearPanel
                  repoPath={dataRepoPath}
                  onStartPromptFromIssue={handleStartPromptFromLinearIssue}
                  onOpenWorkspace={async (workspaceId) => {
                    await invalidateQueries(["workspaces", queryRepoKey]);
                    const updatedWorkspaces = await fetchAndCache(
                      ["workspaces", repoPath],
                      () => getWorkspaces(dataRepoPath),
                    );
                    const workspace = updatedWorkspaces.find(
                      (w) => w.id === workspaceId,
                    );
                    if (workspace) {
                      handleSelectWorkspace(workspace);
                    }
                  }}
                />
              )}

              {/* Merge Preview View */}
              {viewMode === "merge-preview" && mergeWorkspace && (
                <MergePreviewPage
                  workspace={mergeWorkspace}
                  repoPath={dataRepoPath}
                  onCancel={() => {
                    setMergeWorkspace(null);
                    setViewMode("show-workspace");
                  }}
                  onMergeComplete={async () => {
                    // Automatic workspace deletion on merge temporarily disabled
                    // Delete workspace after successful merge
                    // try {
                    //   await deleteWorkspace(
                    //     mergeWorkspace.repo_path,
                    //     mergeWorkspace.workspace_path,
                    //     mergeWorkspace.id
                    //   );
                    //   // Invalidate workspace queries
                    //   void invalidateQueries(["workspaces"]);
                    // } catch (error) {
                    //   addToast({
                    //     title: "Merge succeeded but workspace deletion failed",
                    //     description: "Please manually delete the workspace from the sidebar",
                    //     type: "warning",
                    //   });
                    // } finally {
                    setMergeWorkspace(null);
                    setViewMode("show-workspace");
                    handleReturnToDashboard();
                    void invalidateQueries(["repo-status", queryRepoKey]);
                    void invalidateQueries(["repo-branch", queryRepoKey]);
                    void invalidateQueries(["workspaces", queryRepoKey]);
                    void invalidateQueries([
                      "workspace-statuses",
                      queryRepoKey,
                    ]);
                    // }
                  }}
                />
              )}
            </div>
          </SidebarInset>

          {/* Global Dialogs */}
          {/* Note: MergeDialog removed - git-specific feature */}

          <AlertDialog
            open={pendingChangeMove !== null}
            onOpenChange={(open) => {
              if (!open && !changeMovePending) setPendingChangeMove(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {pendingChangeMove
                    ? `Move ${pendingChangeMove.files.length} ${
                        pendingChangeMove.files.length === 1 ? "file" : "files"
                      } to ${pendingChangeMove.destinationLabel}?`
                    : "Move files?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This moves the selected uncommitted{" "}
                  {pendingChangeMove?.files.length === 1 ? "change" : "changes"}{" "}
                  into the target workspace and removes{" "}
                  {pendingChangeMove?.files.length === 1 ? "it" : "them"} from
                  the current one.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={changeMovePending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={changeMovePending}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleConfirmChangeMove();
                  }}
                >
                  Move
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <UnifiedWorkspaceDialog
            open={unifiedDialogDefaults !== null}
            onOpenChange={(open) => {
              if (!open) setUnifiedDialogDefaults(null);
            }}
            repoPath={dataRepoPath}
            defaults={unifiedDialogDefaults ?? {}}
            onSuccess={async (workspaceId) => {
              await invalidateQueries(["workspaces", queryRepoKey]);
              invalidateQueries(["workspace-statuses", queryRepoKey]);
              const updatedWorkspaces = await fetchAndCache(
                ["workspaces", repoPath],
                () => getWorkspaces(dataRepoPath),
              );
              const newWorkspace = updatedWorkspaces.find(
                (w) => w.id === workspaceId,
              );
              if (newWorkspace) {
                handleOpenSession(newWorkspace);
              }
            }}
          />

          <TerminalMissionControl
            open={showTerminalMissionControl}
            sessions={terminalSessionSummaries}
            repoPath={dataRepoPath}
            workspaces={workspaces}
            onClose={() => setShowTerminalMissionControl(false)}
            onFocus={handleFocusTerminalSession}
          />

          <CommandPalette
            showCommandPalette={showCommandPalette}
            onCommandPaletteChange={setShowCommandPalette}
            workspaces={workspaces}
            onNavigateToDashboard={handleReturnToDashboard}
            onNavigateToSettings={openSettings}
            onOpenRepository={() => void handleOpenRepository()}
            onOpenRepositoryInNewWindow={() =>
              void handleOpenRepositoryInNewWindow()
            }
            onOpenBranchSwitcher={() => setShowBranchSwitcher(true)}
            onOpenFilePicker={() => setShowFilePicker(true)}
            onOpenWorkspacePicker={() => setShowWorkspacePicker(true)}
            onOpenWorkspaceDeletion={() => setShowWorkspaceDeletion(true)}
            onCreateStackedWorkspace={handleCreateStackedWorkspace}
            onToggleTerminal={() => terminalPaneRef.current?.toggleCollapse()}
            onMaximizeTerminal={() => terminalPaneRef.current?.toggleMaximize()}
            onStartAgentWithPrompt={() => setShowAgentPromptDialog(true)}
            onStartAgentTerminal={() => void handleStartDefaultAgent()}
            onOpenPromptHistory={() => {
              setPromptHistoryFocusId(null);
              setShowPromptHistory(true);
            }}
            onOpenStash={() => setShowStashModal(true)}
            onCreateShellTerminal={() =>
              terminalPaneRef.current?.createShellSession()
            }
            hasSelectedWorkspace={!!selectedWorkspace}
            showBranchSwitcher={showBranchSwitcher}
            onBranchSwitcherChange={setShowBranchSwitcher}
            onBranchChanged={handleBranchChanged}
            showWorkspaceDeletion={showWorkspaceDeletion}
            onWorkspaceDeletionChange={setShowWorkspaceDeletion}
            currentWorkspace={selectedWorkspace}
            onDeleteWorkspace={handleDelete}
            showFilePicker={showFilePicker}
            onFilePickerChange={setShowFilePicker}
            onFileSelected={(filePath) => setSessionSelectedFile(filePath)}
            selectedWorkspaceId={selectedWorkspace?.id ?? null}
            repoPath={dataRepoPath}
          />

          <AgentPromptDialog
            open={showAgentPromptDialog}
            onOpenChange={handleAgentPromptDialogOpenChange}
            repoPath={dataRepoPath}
            defaultBranch={effectiveDefaultBranch}
            workspaces={workspaces}
            onSessionCreated={handleSessionCreated}
            initialPrompt={runPromptRequest?.prompt}
            initialWorkspaceId={runPromptRequest?.workspaceId ?? null}
            initialGitHubIssue={runPromptRequest?.githubIssue ?? null}
          />

          <PromptHistoryModal
            open={showPromptHistory}
            onOpenChange={handlePromptHistoryOpenChange}
            repoPath={dataRepoPath}
            initialSelectedId={promptHistoryFocusId}
            onRunPrompt={handleRunPrompt}
          />

          <KeyboardShortcutsModal
            open={showKeyboardShortcuts}
            onOpenChange={setShowKeyboardShortcuts}
          />

          <StashModal
            open={showStashModal}
            onOpenChange={setShowStashModal}
            repoPath={dataRepoPath}
            workspaces={visibleWorkspaces}
            onApplied={() => {
              void invalidateQueries(["workspace-changed-files"]);
              void invalidateQueries(["workspace-diff"]);
            }}
            onApplyToNewWorkspace={(entry) => {
              setShowStashModal(false);
              const source =
                entry.workspace_id != null
                  ? (workspaces.find((w) => w.id === entry.workspace_id) ??
                    null)
                  : null;
              setUnifiedDialogDefaults({
                sourceWorkspace: source,
                targetBranch: source?.branch_name,
                applyStashId: entry.id,
                applyStashCommit: {
                  hash: entry.short_commit_id,
                  message: `Stash from ${entry.workspace_label}`,
                  timestamp: entry.created_at,
                },
                preSelectedCommits: [entry.short_commit_id],
                activeTab: "commits",
                description: `Apply stash ${entry.short_commit_id} (${entry.files_changed.length} files, +${entry.additions}/-${entry.deletions})`,
              });
            }}
          />

          <WorkspacePicker
            open={showWorkspacePicker}
            onOpenChange={setShowWorkspacePicker}
            workspaces={workspaces}
            sessions={sessions}
            workspaceChangeCounts={undefined}
            onSelect={handleOpenSession}
          />
          {remoteSshDialog}
          <RemoteAmbiguousMutationDialog />
        </SidebarProvider>
      )}
    </ActiveRepositoryProvider>
  );
};
