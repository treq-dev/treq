import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { openRepositoryAtPath } from "./open-repository";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    initRepo: vi.fn(),
    setSetting: vi.fn(),
    setWindowRepoPath: vi.fn(),
  };
});

vi.mock("./swr-cache", () => ({
  invalidateQueries: vi.fn(),
}));

describe("openRepositoryAtPath", () => {
  beforeEach(() => {
    vi.mocked(api.initRepo).mockReset();
    vi.mocked(api.setSetting).mockReset();
    vi.mocked(api.setWindowRepoPath).mockReset();
  });

  it("initializes exactly one repository and reports success for a valid path", async () => {
    vi.mocked(api.initRepo).mockResolvedValueOnce(true);
    const onOpened = vi.fn();
    const addToast = vi.fn();

    await openRepositoryAtPath("/repos/one", { addToast, onOpened });

    expect(api.initRepo).toHaveBeenCalledTimes(1);
    expect(api.initRepo).toHaveBeenCalledWith("/repos/one");
    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(onOpened).toHaveBeenCalledWith("/repos/one");
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" }),
    );
  });

  it("causes no state change when the selection is invalid (init fails)", async () => {
    vi.mocked(api.initRepo).mockRejectedValueOnce(new Error("not a git repo"));
    const onOpened = vi.fn();
    const addToast = vi.fn();

    await openRepositoryAtPath("/repos/not-a-repo", { addToast, onOpened });

    expect(onOpened).not.toHaveBeenCalled();
    expect(api.setSetting).not.toHaveBeenCalled();
    expect(api.setWindowRepoPath).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
  });
});
