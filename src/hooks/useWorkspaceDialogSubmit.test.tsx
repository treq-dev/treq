import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  applyStash: vi.fn(),
  createWorkspace: vi.fn(),
  getRepoCurrentBranch: vi.fn(),
  getWorkspaces: vi.fn(),
  moveWorkspaceChanges: vi.fn(),
  setWorkspaceTargetBranch: vi.fn(),
}));
const addToast = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  ...api,
}));
vi.mock("../components/ui/toast", () => ({
  useToast: () => ({ addToast }),
}));
vi.mock("./useCreateStackedWorkspace", () => ({
  useCreateStackedWorkspace: () => ({ createStackedWorkspace: vi.fn() }),
}));

import {
  type UseWorkspaceDialogSubmitParams,
  useWorkspaceDialogSubmit,
} from "./useWorkspaceDialogSubmit";

function params(
  overrides: Partial<UseWorkspaceDialogSubmitParams> = {},
): UseWorkspaceDialogSubmitParams {
  return {
    repoPath: "/repo",
    title: "",
    description: "",
    sparsePaths: "",
    symlinkedDirs: "",
    branchName: "feat-b",
    branchStatusName: "feat-b",
    moveToExisting: false,
    isHomeRepo: false,
    hasSourceWorkspace: false,
    sourceWorkspace: null,
    position: "after",
    targetBranch: null,
    allWorkspaces: [],
    branchStatusData: null,
    activeRightTab: "commits",
    selectedCommits: new Set(),
    selectedHunks: new Set(),
    selectedFilePaths: [],
    targetWorkspaceId: null,
    canSubmit: true,
    applyStashId: null,
    setLoading: vi.fn(),
    setError: vi.fn(),
    onSuccess: vi.fn(),
    onOpenChange: vi.fn(),
    ...overrides,
  };
}

describe("useWorkspaceDialogSubmit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createWorkspace.mockResolvedValue(7);
  });

  it("uses the remote ref only when the branch check matches the submitted name", async () => {
    const p = params({
      branchName: "feat-b",
      branchStatusName: "feat-a",
      branchStatusData: {
        local_exists: false,
        remote_exists: true,
        remote_name: "origin",
        remote_ref: "feat-a@origin",
      },
    });
    const { result } = renderHook(() => useWorkspaceDialogSubmit(p));

    await act(() => result.current.handleSubmit());

    expect(api.createWorkspace).toHaveBeenCalledWith(
      "/repo",
      "feat-b",
      undefined,
      expect.any(String),
    );
  });

  it("uses the remote ref for a matching branch check", async () => {
    const p = params({
      branchName: "feat-a",
      branchStatusName: "feat-a",
      branchStatusData: {
        local_exists: false,
        remote_exists: true,
        remote_name: "origin",
        remote_ref: "feat-a@origin",
      },
    });
    const { result } = renderHook(() => useWorkspaceDialogSubmit(p));

    await act(() => result.current.handleSubmit());

    expect(api.createWorkspace).toHaveBeenCalledWith(
      "/repo",
      "feat-a",
      "feat-a@origin",
      expect.any(String),
    );
  });

  it("opens the created workspace when a follow-up step fails", async () => {
    api.applyStash.mockRejectedValue(new Error("stash conflict"));
    const p = params({ applyStashId: 3 });
    const { result } = renderHook(() => useWorkspaceDialogSubmit(p));

    await act(() => result.current.handleSubmit());

    expect(p.onSuccess).toHaveBeenCalledWith(7);
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "Workspace created with errors",
        description: expect.stringContaining("stash conflict"),
      }),
    );
  });

  it("keeps the dialog open when the create itself fails", async () => {
    api.createWorkspace.mockRejectedValue(new Error("bad name"));
    const p = params();
    const { result } = renderHook(() => useWorkspaceDialogSubmit(p));

    await act(() => result.current.handleSubmit());

    expect(p.onSuccess).not.toHaveBeenCalled();
    expect(p.onOpenChange).not.toHaveBeenCalled();
    expect(p.setError).toHaveBeenCalledWith("bad name");
  });
});
