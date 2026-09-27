import { listen } from "@tauri-apps/api/event";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  usePrCiStatus,
  usePrInfoViaGh,
  usePrStatusPolling,
} from "./useMergeQueueStatus";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  startPrStatusPolling: vi.fn(async () => undefined),
  stopPrStatusPolling: vi.fn(async () => undefined),
  refreshPrBranchStatus: vi.fn(async () => undefined),
  getCachedPrInfo: vi.fn(async () => null),
  getCachedPrCiStatus: vi.fn(async () => null),
  listCachedPrStatuses: vi.fn(async () => ({})),
  listCachedPrCiStatuses: vi.fn(async () => ({})),
}));

describe("pr-statuses-updated listener", () => {
  let resolveListen: (unlisten: () => void) => void;

  beforeEach(() => {
    vi.mocked(listen).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveListen = resolve;
        }),
    );
  });

  it.each<[string, () => unknown]>([
    ["usePrStatusPolling", () => usePrStatusPolling("/tmp/repo")],
    ["usePrInfoViaGh", () => usePrInfoViaGh("/tmp/repo", "feat")],
    ["usePrCiStatus", () => usePrCiStatus("/tmp/repo", "feat")],
  ])("%s removes a listener that registers after unmount", async (_name, hook) => {
    const { unmount } = renderHook(hook);
    await vi.waitFor(() => expect(listen).toHaveBeenCalled());

    unmount();
    const unlisten = vi.fn();
    resolveListen(unlisten);

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });
});
