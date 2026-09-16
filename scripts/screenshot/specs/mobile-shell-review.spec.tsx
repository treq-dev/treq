import * as React from "react";
import { it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  createTestRepo,
  openRepo,
  resolveWorkspacePath,
  seedAgentReviewComment,
  writeWorkspaceFile,
} from "../../../test/utils";
import {
  checkAndRebaseWorkspaces,
  createCommit,
  createWorkspace,
  ensureWorkspaceIndexed,
  getWorkspaces,
  setSetting,
} from "../../../src/lib/api";
import { render, screen } from "../../../test/test-utils";
import { MobileShell } from "../../../src/components/MobileShell";
import { captureDocument } from "../capture";
import * as api from "../../../src/lib/api";
import * as remoteControlPlane from "../../../src/lib/remote-control-plane";
import * as remoteDispatch from "../../../src/lib/remote-dispatch";

// RemoteConnectPanel's connected/error states depend on the control-plane
// edge functions and SSH dispatch - none of which the local-jj-repo test
// harness provides a real backend for. Mocked here the same way
// src/components/mobile/RemoteTerminalScreen.test.tsx mocks the equivalent
// remote-dispatch surface for that screen: vi.mock the module, keep every
// other export real via importActual, and only stub the calls this flow
// makes.
vi.mock("../../../src/lib/remote-control-plane", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/lib/remote-control-plane")
  >("../../../src/lib/remote-control-plane");
  return {
    ...actual,
    getInstanceStatus: vi.fn(),
    registerClientKey: vi.fn(),
    issueCertificate: vi.fn(),
  };
});

vi.mock("../../../src/lib/remote-dispatch", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/lib/remote-dispatch")
  >("../../../src/lib/remote-dispatch");
  return { ...actual, dispatchOverSsh: vi.fn() };
});

vi.mock("../../../src/lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
    "../../../src/lib/api",
  );
  return { ...actual, ensureMobileDeviceKey: vi.fn() };
});

const REMOTE_ENDPOINT = {
  id: "ep-mobile-review",
  instance_id: "inst-mobile-review",
  source: { type: "managed" as const, provider: "fly_sprites", generation: 1 },
  hostname: "vm-mobile-review.treq.dev",
  port: 22,
  username: "treq",
  host_keys: [],
  authentication: { type: "public_key" as const, key_reference: "key1" },
};

it("captures the mobile shell's changes, history, and conflicts tabs", async () => {
  const branchName = "feat/mobile-review";
  const { repoPath, defaultBranch } = createTestRepo(false);
  openRepo(repoPath);

  const workspaceId = await createWorkspace(repoPath, branchName);
  const workspace = (await getWorkspaces(repoPath)).find(
    (w) => w.id === workspaceId,
  );
  if (!workspace) throw new Error("Workspace not found");
  const workspacePath = resolveWorkspacePath(
    repoPath,
    workspace.workspace_path,
  );

  // A committed history entry.
  writeWorkspaceFile(workspacePath, "README.md", "workspace side\n");
  await createCommit(repoPath, workspaceId, "workspace conflicting change");

  // A conflicting commit on the other side, then rebase onto it: produces a
  // real conflict with resolvable diff regions (matches the fixture used by
  // test/integration/review/conflict.test.tsx's InlineConflictCard coverage).
  writeWorkspaceFile(repoPath, "README.md", "main side\n");
  await createCommit(repoPath, null, "main conflicting change");
  await checkAndRebaseWorkspaces(repoPath, workspaceId, defaultBranch, true);
  await ensureWorkspaceIndexed(repoPath, workspaceId, workspacePath);

  // An extra uncommitted change for the Changes tab.
  writeWorkspaceFile(workspacePath, "notes.txt", "a fresh note\n");

  // Seeded before MobileShell mounts: the review-comments hook disables SWR
  // polling in test mode, so only the diff view's initial fetch on mount will
  // ever pick up a row inserted this way.
  seedAgentReviewComment(repoPath, {
    workspaceId,
    filePath: "notes.txt",
    startLine: 1,
    side: "new",
    commentText: "Consider adding a timestamp to this note.",
  });

  await setSetting("lastRepoPath", repoPath);

  const user = userEvent.setup();
  render(<MobileShell />);

  const workspaceButton = await screen.findByText(workspace.workspace_name);
  await captureDocument(document, {
    name: "mobile-shell-review-01-workspace-list",
    expectations: [
      "A single-column mobile layout with a 'Treq' header and a workspace list.",
      `A workspace entry labeled "${workspace.workspace_name}" is visible as a tappable row.`,
    ],
  });

  await user.click(workspaceButton);
  await screen.findByText("notes.txt");
  await captureDocument(document, {
    name: "mobile-shell-review-02-changes-tab",
    expectations: [
      "Changes/History/Conflicts tabs are visible with Changes selected.",
      "A file row for notes.txt is listed under the changes.",
      'A "1 local review comment" indicator with a bot icon is visible above the file list.',
    ],
  });

  await user.click(screen.getByText("notes.txt"));
  await screen.findByText(/a fresh note/);
  await screen.findByTestId("agent-review-comment-card");
  await captureDocument(document, {
    name: "mobile-shell-review-03-changes-expanded",
    expectations: [
      "The notes.txt file row is expanded to show its diff hunk inline.",
      "Added lines are shown with a green/positive background and a leading +.",
      'A "Local" badged review comment card is shown under the added line, with Resolve and Delete actions.',
    ],
  });

  await user.click(screen.getByRole("tab", { name: "History" }));
  await screen.findByText("Commits");
  await captureDocument(document, {
    name: "mobile-shell-review-04-history-tab",
    expectations: [
      "A vertical commit timeline is shown under a 'Commits' heading.",
      "At least one commit entry with a headline is visible in the list.",
    ],
  });

  await user.click(screen.getByRole("tab", { name: "Conflicts" }));
  await screen.findByText("README.md");
  await captureDocument(document, {
    name: "mobile-shell-review-05-conflicts-tab",
    expectations: [
      "A conflicts list is shown with a README.md entry marked as conflicted.",
    ],
  });

  await user.click(screen.getByText("README.md"));
  await screen.findByText(/Conflict 1 of/);
  await captureDocument(document, {
    name: "mobile-shell-review-06-conflict-detail",
    expectations: [
      "A 'Back to conflicts' link and the conflicted file path are shown above the conflict markers.",
      "Conflict marker lines and both sides' content are rendered in a monospace block.",
    ],
  });

  await captureDocument(document, {
    name: "mobile-shell-review-07-remote-connect-panel",
    expectations: [
      "A 'Remote instance' section is visible below the local repo review content.",
      "A 'Connect to managed instance' button is shown, not yet connected.",
    ],
  });

  // Connected state: the connect flow (ensureMobileDeviceKey ->
  // registerClientKey -> getInstanceStatus -> issueCertificate) all succeed.
  vi.mocked(api.ensureMobileDeviceKey).mockResolvedValue({
    public_key: "ssh-ed25519 AAAAmobiledevicekey",
    fingerprint_sha256: "SHA256:mobiledevicefingerprint",
  });
  vi.mocked(remoteControlPlane.registerClientKey).mockResolvedValue({
    operation_id: "op-register-1",
    status: "succeeded",
    key: {
      id: "key-1",
      algorithm: "ssh-ed25519",
      fingerprint_sha256: "SHA256:mobiledevicefingerprint",
      comment: "treq-mobile-device",
      created_at: "2026-01-01T00:00:00Z",
      revoked_at: null,
    },
  });
  vi.mocked(remoteControlPlane.getInstanceStatus).mockResolvedValue({
    instance: {
      instance_id: "inst-mobile-review",
      owner_user_id: "user-1",
      provider_kind: "fly_sprites",
      provider_resource_id: "res-1",
      region: "us_east",
      size_preset: "small",
      status: "ready",
      generation: 1,
      endpoint_id: "ep-mobile-review",
      image_manifest_version: 1,
      created_at: "2026-01-01T00:00:00Z",
      ready_at: "2026-01-01T00:05:00Z",
      disk_quota_gb: 20,
    },
    endpoint: REMOTE_ENDPOINT,
  });
  vi.mocked(remoteControlPlane.issueCertificate).mockResolvedValue({
    certificate: "ssh-cert-mobile-review",
    serial: "1",
    expires_at: "2026-01-01T01:00:00Z",
    endpoint: REMOTE_ENDPOINT,
  });

  const connectButton = await screen.findByRole("button", {
    name: "Connect to managed instance",
  });
  await user.click(connectButton);
  await screen.findByText(
    `Connected to ${REMOTE_ENDPOINT.hostname}:${REMOTE_ENDPOINT.port}`,
  );
  await captureDocument(document, {
    name: "mobile-shell-review-08-remote-connected",
    expectations: [
      "The Remote instance section now shows 'Connected to vm-mobile-review.treq.dev:22' instead of the Connect button.",
      "A repository path text input and an 'Inspect repository' button are visible below the connected message.",
    ],
  });

  // Error state: inspecting a repository fails (e.g. the ProbeRepo dispatch
  // over SSH rejects). The connect step above already succeeded, so this
  // shows the error surfaced from a later step in the same flow, still
  // reachable while `endpoint` is set.
  const dispatchOverSshMock = vi.mocked(remoteDispatch.dispatchOverSsh);
  dispatchOverSshMock.mockRejectedValueOnce(
    new Error("Connection to vm-mobile-review.treq.dev timed out."),
  );

  const repoPathInput = screen.getByPlaceholderText(
    "Repository path on the instance",
  );
  await user.type(repoPathInput, "/srv/missing-project");
  await user.click(screen.getByRole("button", { name: "Inspect repository" }));
  await screen.findByText("Connection to vm-mobile-review.treq.dev timed out.");
  await captureDocument(document, {
    name: "mobile-shell-review-09-remote-error",
    expectations: [
      "A red/destructive error message 'Connection to vm-mobile-review.treq.dev timed out.' is visible in the Remote instance section.",
      "The panel still shows the connected endpoint and repository path input above the error, not a fresh Connect button.",
    ],
  });
}, 60000);
