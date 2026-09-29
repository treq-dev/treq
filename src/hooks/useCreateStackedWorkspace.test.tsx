import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockWorkspace } from "../../test/factories/workspace.factory";

const api = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  getRepoDefaultBranch: vi.fn(),
  getRepoSetting: vi.fn(),
  getWorkspaces: vi.fn(),
  setWorkspaceTargetBranch: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  ...api,
}));
vi.mock("../components/ui/toast", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

import { useCreateStackedWorkspace } from "./useCreateStackedWorkspace";

describe("useCreateStackedWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getRepoDefaultBranch.mockResolvedValue("main");
    api.getRepoSetting.mockResolvedValue(null);
    api.createWorkspace.mockResolvedValue(9);
  });

  it("refuses to stack on a parent workspace removed while the dialog was open", async () => {
    const parent = createMockWorkspace({ id: 3, branch_name: "feat-a" });
    // The parent is gone by the time the user submits.
    api.getWorkspaces.mockResolvedValue([]);

    const { result } = renderHook(() => useCreateStackedWorkspace());

    await expect(
      result.current.createStackedWorkspace({
        repoPath: "/repo",
        parentBranch: parent.branch_name,
        parentWorkspace: parent,
        reportErrors: false,
      }),
    ).rejects.toThrow(/feat-a no longer exists/);
    expect(api.createWorkspace).not.toHaveBeenCalled();
  });
});
