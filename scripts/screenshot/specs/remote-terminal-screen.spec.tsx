/**
 * Mobile PTY streaming/reattach UI (mobile PRD Phase 7 item 3):
 * `RemoteTerminalScreen` -> `RemoteTerminalPanel`. This needs a connected
 * `SshEndpoint` and running remote sessions that the local-jj-repo test
 * harness has no real backend for, so the control-plane/SSH-adjacent calls
 * are mocked the same way `src/components/mobile/RemoteTerminalScreen.test.tsx`
 * mocks them for its own unit coverage: `vi.mock` the module, keep every
 * other export real via `importActual`, and only stub the remote-PTY IPC
 * calls. The xterm.js rendering itself is not mocked - it's the same real
 * `@xterm/xterm` instance `terminal-sessions-sidebar.spec.tsx` and friends
 * already prove rasterizes fine through this harness for local terminals.
 */
import * as React from "react";
import { expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "../../../test/test-utils";
import { RemoteTerminalScreen } from "../../../src/components/mobile/RemoteTerminalScreen";
import { captureDocument } from "../capture";
import * as remoteDispatch from "../../../src/lib/remote-dispatch";
import * as apiExtra from "../../../src/lib/api-extra";
import type { SshEndpoint } from "../../../src/lib/api-types-remote";

vi.mock("../../../src/lib/remote-dispatch", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/lib/remote-dispatch")
  >("../../../src/lib/remote-dispatch");
  return { ...actual, dispatchOverSsh: vi.fn() };
});

vi.mock("../../../src/lib/api-extra", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/lib/api-extra")
  >("../../../src/lib/api-extra");
  return {
    ...actual,
    remotePtyListPersistentSessions: vi.fn(),
    remotePtyCreate: vi.fn(),
    remotePtyReattach: vi.fn(),
    remotePtyListen: vi.fn(),
    remotePtyListenExit: vi.fn(),
    remotePtyClose: vi.fn(),
    remotePtyResize: vi.fn(),
    remotePtyWrite: vi.fn(),
  };
});

const ENDPOINT: SshEndpoint = {
  id: "ep-terminal-screen",
  instance_id: "inst-terminal-screen",
  source: { type: "managed", provider: "fly_sprites", generation: 1 },
  hostname: "vm-terminal-screen.treq.dev",
  port: 22,
  username: "treq",
  host_keys: [],
  authentication: { type: "public_key", key_reference: "key1" },
};

const REPO = "/srv/project";
const WORKSPACE = "feature-branch";
const WORKSPACE_PATH = "/srv/project/.treq-workspaces/feature-branch";

it("captures the remote terminal screen's session list and a started session", async () => {
  vi.mocked(remoteDispatch.dispatchOverSsh).mockImplementation(
    async (_endpoint, request) => {
      if (request.kind === "ListWorkspaces") {
        return [
          {
            id: 1,
            repo_path: REPO,
            workspace_name: WORKSPACE,
            workspace_path: WORKSPACE_PATH,
            branch_name: WORKSPACE,
            created_at: "2026-01-01T00:00:00Z",
            title: WORKSPACE,
            not_on_remote: false,
          },
        ] as never;
      }
      throw new Error(`unexpected dispatch: ${request.kind}`);
    },
  );
  vi.mocked(apiExtra.remotePtyListPersistentSessions).mockResolvedValue([
    {
      session_name: "shell-1",
      workspace: WORKSPACE,
      label: "shell",
      running: true,
    },
    {
      session_name: "shell-2",
      workspace: WORKSPACE,
      label: "shell-2",
      running: false,
    },
  ]);
  vi.mocked(apiExtra.remotePtyCreate).mockResolvedValue(undefined);
  vi.mocked(apiExtra.remotePtyReattach).mockResolvedValue(undefined);
  vi.mocked(apiExtra.remotePtyListen).mockResolvedValue(() => {});
  vi.mocked(apiExtra.remotePtyListenExit).mockResolvedValue(() => {});
  vi.mocked(apiExtra.remotePtyClose).mockResolvedValue(undefined);

  const user = userEvent.setup();
  render(
    <RemoteTerminalScreen
      endpoint={ENDPOINT}
      repo={REPO}
      workspace={WORKSPACE}
    />,
  );

  await screen.findByText("shell");
  await screen.findByText("shell-2");
  await captureDocument(document, {
    name: "remote-terminal-screen-01-session-list",
    expectations: [
      "A 'Terminal' heading with a 'Running sessions' list showing two rows labeled 'shell' and 'shell-2'.",
      "The 'shell' row shows 'running' status with an enabled 'Reattach' button; the 'shell-2' row shows 'stopped' status with its 'Reattach' button disabled/dimmed.",
      "A 'Start new session' button is visible below the session list.",
    ],
  });

  const startButton = await screen.findByText("Start new session");
  await user.click(startButton);

  expect(apiExtra.remotePtyCreate).toHaveBeenCalledWith(
    expect.any(String),
    ENDPOINT,
    REPO,
    WORKSPACE,
    WORKSPACE_PATH,
    expect.anything(),
    expect.any(Number),
    expect.any(Number),
  );

  await waitFor(() => {
    expect(screen.queryByText("Starting remote shell…")).toBeNull();
  });
  await screen.findByText(`${ENDPOINT.hostname} · shell-3`);
  await captureDocument(document, {
    name: "remote-terminal-screen-02-started-session",
    expectations: [
      "A full-screen dark terminal panel is shown with a header reading 'vm-terminal-screen.treq.dev · shell-3'.",
      "Stop and Detach (X) controls are visible in the top-right of the header, and no 'Starting remote shell…' loading overlay is shown.",
    ],
  });
}, 60000);
