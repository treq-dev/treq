import type { User } from "@supabase/supabase-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "../../test/test-utils";
import { MobileShell } from "./MobileShell";
import * as api from "../lib/api";
import { defaultAuthState, useAuthStore } from "../stores/authStore";
import {
  createMockWorkspace,
  createMockWorkspaceStatus,
} from "../../test/factories/workspace.factory";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    setTitle: vi.fn(),
    onFocusChanged: vi.fn().mockResolvedValue(() => {}),
  }),
  WebviewWindow: vi.fn(),
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual("../lib/api");
  return {
    ...actual,
    getSetting: vi.fn(),
    getWorkspaces: vi.fn(),
    getWorkspaceDiff: vi.fn(),
    getWorkspaceStatus: vi.fn(),
    listCommits: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ ...defaultAuthState, loading: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MobileShell on a mobile build", () => {
  it("starts with sign-in and the remote flow, without local repository views", async () => {
    const user = userEvent.setup();
    vi.stubEnv("TAURI_ENV_PLATFORM", "android");
    vi.mocked(api.getSetting).mockResolvedValue("/repo");

    render(<MobileShell />);

    expect(
      screen.getByRole("button", { name: "Connect to managed instance" }),
    ).toBeDisabled();
    expect(
      screen.queryByText("Local repository (dev preview)"),
    ).not.toBeInTheDocument();
    expect(api.getWorkspaces).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(openUrl).toHaveBeenCalledWith(
      expect.stringContaining("/sign-in?source=desktop"),
    );
  });

  it("shows the account once signed in", async () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "ios");
    useAuthStore.setState({
      user: { id: "u1", email: "me@example.com" } as User,
    });

    render(<MobileShell />);

    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect to managed instance" }),
    ).toBeEnabled();
  });
});

describe("MobileShell dev preview on desktop", () => {
  it("lists workspaces and drills into a workspace's changes tab", async () => {
    const user = userEvent.setup();
    const workspace = createMockWorkspace({
      id: 7,
      workspace_name: "feat/mobile-review",
    });

    vi.mocked(api.getSetting).mockResolvedValue("/repo");
    vi.mocked(api.getWorkspaces).mockResolvedValue([workspace]);
    vi.mocked(api.getWorkspaceDiff).mockResolvedValue({
      committed_files: [
        {
          path: "src/foo.ts",
          status: "M",
          previous_path: null,
          changed_line_count: 1,
          diff_deferred: false,
        },
      ],
      hunks_by_file: [
        {
          path: "src/foo.ts",
          hunks: [
            {
              id: "h1",
              header: "@@ -1 +1 @@",
              lines: ["+hello"],
              patch: "",
            },
          ],
        },
      ],
      uncommitted_files: [],
      conflicted_files: [],
      too_large_to_render: false,
    });

    render(<MobileShell />);

    const workspaceButton = await screen.findByText("feat/mobile-review");
    await user.click(workspaceButton);

    expect(await screen.findByText("src/foo.ts")).toBeInTheDocument();

    await user.click(screen.getByText("src/foo.ts"));
    expect(await screen.findByText("+hello")).toBeInTheDocument();
  });

  it("shows conflicted files in the conflicts tab", async () => {
    const user = userEvent.setup();
    const workspace = createMockWorkspace({ id: 3, workspace_name: "ws-3" });

    vi.mocked(api.getSetting).mockResolvedValue("/repo");
    vi.mocked(api.getWorkspaces).mockResolvedValue([workspace]);
    vi.mocked(api.getWorkspaceDiff).mockResolvedValue({
      committed_files: [],
      hunks_by_file: [],
      uncommitted_files: [],
      conflicted_files: [],
      too_large_to_render: false,
    });
    vi.mocked(api.getWorkspaceStatus).mockResolvedValue(
      createMockWorkspaceStatus({
        conflicted_files: ["src/conflicted.ts"],
      }),
    );

    render(<MobileShell />);

    await user.click(await screen.findByText("ws-3"));
    await user.click(await screen.findByText("Conflicts"));

    await waitFor(() => {
      expect(screen.getByText("conflicted.ts")).toBeInTheDocument();
    });
  });
});
