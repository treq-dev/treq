import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/test-utils";
import { useAuthStore } from "../../stores/authStore";
import { GoogleWorkspacePanel } from "./GoogleWorkspacePanel";

const mocks = vi.hoisted(() => ({
  googleConnectionStatus: vi.fn(),
  googleListTaskLists: vi.fn(),
}));

vi.mock("../../lib/proxy-session-sync", () => ({
  ensureProxySessionSync: () => Promise.resolve(),
}));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  getWorkspaces: () => Promise.resolve([]),
}));
vi.mock("../../lib/api-google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-google")>()),
  ...mocks,
}));

const renderPanel = (onOpenSettings = vi.fn()) => {
  render(
    <GoogleWorkspacePanel
      repoPath="/repo"
      onStartDocReview={vi.fn()}
      onKickoffTask={vi.fn()}
      onOpenSettings={onOpenSettings}
    />,
  );
  return onOpenSettings;
};

describe("GoogleWorkspacePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.googleListTaskLists.mockResolvedValue([]);
    useAuthStore.setState({
      subscription: { plan: "pro", status: "active" } as never,
    });
  });

  it("shows the Pro upsell instead of the board on a free plan", async () => {
    useAuthStore.setState({ subscription: null });
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "proxy" });
    renderPanel();
    expect(
      await screen.findByText("Unlock Google Workspace"),
    ).toBeInTheDocument();
    expect(mocks.googleConnectionStatus).not.toHaveBeenCalled();
    expect(mocks.googleListTaskLists).not.toHaveBeenCalled();
  });

  it("shows a status error with Retry instead of spinning", async () => {
    mocks.googleConnectionStatus.mockRejectedValueOnce("keychain locked");
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    renderPanel();
    expect(await screen.findByText("keychain locked")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText(/Google Workspace is not connected/),
    ).toBeInTheDocument();
  });

  it("offers to connect from the not-connected state", async () => {
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    const onOpenSettings = renderPanel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Connect Google Workspace" }),
    );
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("offers a reconnect when the grant has expired", async () => {
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "proxy" });
    mocks.googleListTaskLists.mockRejectedValue(
      "Google authorization expired. Reconnect Google Workspace in Settings.",
    );
    const onOpenSettings = renderPanel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Reconnect in Settings" }),
    );
    expect(onOpenSettings).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
