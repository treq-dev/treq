import { openUrl } from "@tauri-apps/plugin-opener";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { useAuthStore } from "../../stores/authStore";
import { useToastStore } from "../../stores/toastStore";
import {
  GoogleIntegrationSettings,
  PRO_POLL_INTERVAL_MS,
  PRO_POLL_TIMEOUT_MS,
} from "./GoogleIntegrationSettings";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  googleConnectionStatus: vi.fn(),
  getRepoSetting: vi.fn(),
  setRepoSetting: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
  SUPABASE_URL: "https://proj.supabase.co",
}));
vi.mock("../../lib/proxy-session-sync", () => ({
  ensureProxySessionSync: () => Promise.resolve(),
}));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  getRepoSetting: mocks.getRepoSetting,
  setRepoSetting: mocks.setRepoSetting,
}));
vi.mock("../../lib/api-google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-google")>()),
  googleConnectionStatus: mocks.googleConnectionStatus,
}));

const PRO = { plan: "pro", status: "active" } as never;

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);
const toastDescriptions = () =>
  useToastStore.getState().toasts.map((t) => t.description);

describe("GoogleIntegrationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    mocks.invoke.mockResolvedValue({
      data: { disconnected: true },
      error: null,
    });
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "proxy" });
    mocks.getRepoSetting.mockResolvedValue("");
    mocks.setRepoSetting.mockResolvedValue(undefined);
    useAuthStore.setState({ user: null, subscription: PRO });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("disconnects the treq-held grant after confirming", async () => {
    useAuthStore.setState({ user: { id: "u1" } as never, subscription: PRO });
    render(<GoogleIntegrationSettings />);
    expect(
      await screen.findByText("Connected through treq (Pro)"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(mocks.invoke).not.toHaveBeenCalled();
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Disconnect",
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect-google", {
      body: {},
    });
  });

  it("hides every disconnect when signed out and not connected", async () => {
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    render(<GoogleIntegrationSettings />);
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Disconnect|Remove Google/ }),
    ).not.toBeInTheDocument();
  });

  it("shows an error toast when saving review instructions fails", async () => {
    mocks.setRepoSetting.mockRejectedValue("disk full");
    render(<GoogleIntegrationSettings repoPath="/repo" />);
    await userEvent.type(
      screen.getByLabelText("Document review instructions"),
      "Cite sources",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toastTitles()).toContain("Failed to save review instructions"),
    );
  });

  it("polls after a Pro connect until the grant lands", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useAuthStore.setState({
      user: { id: "u1" } as never,
      subscription: { plan: "pro", status: "active" } as never,
    });
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    mocks.invoke.mockResolvedValue({
      data: { authorize_url: "https://treq/authorize" },
      error: null,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<GoogleIntegrationSettings />);
    await screen.findByText("Not connected");
    await user.click(
      screen.getByRole("button", { name: "Connect with Google" }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://treq/authorize");
    await vi.advanceTimersByTimeAsync(PRO_POLL_INTERVAL_MS);
    expect(toastTitles()).not.toContain("Google Workspace connected");
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "proxy" });
    await vi.advanceTimersByTimeAsync(PRO_POLL_INTERVAL_MS);
    expect(
      await screen.findByText("Connected through treq (Pro)"),
    ).toBeInTheDocument();
    expect(toastTitles()).toContain("Google Workspace connected");
  });

  it("shows the Edge Function's error text", async () => {
    useAuthStore.setState({
      user: { id: "u1" } as never,
      subscription: { plan: "pro", status: "active" } as never,
    });
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    mocks.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("non-2xx"), {
        context: new Response(JSON.stringify({ error: "Pro plan required" })),
      }),
    });
    render(<GoogleIntegrationSettings />);
    await screen.findByText("Not connected");
    await userEvent.click(
      screen.getByRole("button", { name: "Connect with Google" }),
    );
    await waitFor(() =>
      expect(toastDescriptions()).toContain("Pro plan required"),
    );
  });

  const startProConnect = async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useAuthStore.setState({
      user: { id: "u1" } as never,
      subscription: { plan: "pro", status: "active" } as never,
    });
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    mocks.invoke.mockResolvedValue({
      data: { authorize_url: "https://treq/authorize" },
      error: null,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = render(<GoogleIntegrationSettings />);
    await screen.findByText("Not connected");
    await user.click(
      screen.getByRole("button", { name: "Connect with Google" }),
    );
    await screen.findByText("Waiting for Google sign-in in your browser…");
    return { user, view };
  };

  it("stops polling once unmounted", async () => {
    const { view } = await startProConnect();
    view.unmount();
    const calls = mocks.googleConnectionStatus.mock.calls.length;
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "proxy" });
    await vi.advanceTimersByTimeAsync(PRO_POLL_INTERVAL_MS * 3);
    expect(mocks.googleConnectionStatus.mock.calls.length).toBe(calls);
    expect(toastTitles()).not.toContain("Google Workspace connected");
  });

  it("tells the user when the Pro sign-in times out", async () => {
    await startProConnect();
    await vi.advanceTimersByTimeAsync(PRO_POLL_TIMEOUT_MS + 1);
    expect(toastTitles()).toContain("Didn't hear back from Google sign-in");
    expect(
      screen.queryByText("Waiting for Google sign-in in your browser…"),
    ).not.toBeInTheDocument();
  });

  it("cancels waiting for a Pro sign-in", async () => {
    const { user } = await startProConnect();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByText("Waiting for Google sign-in in your browser…"),
    ).not.toBeInTheDocument();
    const calls = mocks.googleConnectionStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(PRO_POLL_INTERVAL_MS * 3);
    expect(mocks.googleConnectionStatus.mock.calls.length).toBe(calls);
  });

  it("treats a canceled plan inside its paid period as Pro", async () => {
    useAuthStore.setState({
      user: { id: "u1" } as never,
      subscription: {
        plan: "pro",
        status: "canceled",
        current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
      } as never,
    });
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    render(<GoogleIntegrationSettings />);
    await screen.findByText("Not connected");
    expect(
      screen.getByRole("button", { name: "Connect with Google" }),
    ).toBeEnabled();
  });

  it("shows an upsell instead of Connect on a free plan", async () => {
    useAuthStore.setState({ user: { id: "u1" } as never, subscription: null });
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    render(<GoogleIntegrationSettings repoPath="/repo" />);
    expect(
      await screen.findByText("Unlock Google Workspace"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect with Google" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Document review instructions"),
    ).not.toBeInTheDocument();
    // A lapsed plan can still remove the grant treq holds.
    await userEvent.click(
      screen.getByRole("button", {
        name: "Remove Google from your treq account",
      }),
    );
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Disconnect",
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect-google", {
      body: {},
    });
  });

  it("shows a status error with Retry instead of Not connected", async () => {
    mocks.googleConnectionStatus.mockRejectedValue("keychain locked");
    render(<GoogleIntegrationSettings />);
    expect(
      await screen.findByText(/Couldn't check the connection: keychain locked/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Not connected")).not.toBeInTheDocument();
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });
});
