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
  googleOAuthBegin: vi.fn(),
  googleOAuthComplete: vi.fn(),
  googleOAuthCancel: vi.fn(),
  googleDisconnectLocal: vi.fn(),
  getSetting: vi.fn(),
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
  getSetting: mocks.getSetting,
  getRepoSetting: mocks.getRepoSetting,
  setRepoSetting: mocks.setRepoSetting,
}));
vi.mock("../../lib/api-google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-google")>()),
  googleConnectionStatus: mocks.googleConnectionStatus,
  googleOAuthBegin: mocks.googleOAuthBegin,
  googleOAuthComplete: mocks.googleOAuthComplete,
  googleOAuthCancel: mocks.googleOAuthCancel,
  googleDisconnectLocal: mocks.googleDisconnectLocal,
}));

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

describe("GoogleIntegrationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    mocks.invoke.mockResolvedValue({
      data: { disconnected: true },
      error: null,
    });
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "proxy" });
    mocks.getSetting.mockResolvedValue("saved-client");
    mocks.getRepoSetting.mockResolvedValue("");
    mocks.setRepoSetting.mockResolvedValue(undefined);
    mocks.googleOAuthBegin.mockResolvedValue("https://accounts.google/x");
    mocks.googleOAuthCancel.mockResolvedValue(undefined);
    mocks.googleDisconnectLocal.mockResolvedValue(undefined);
    useAuthStore.setState({ user: null, subscription: null });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("disconnects the treq-held grant after confirming", async () => {
    useAuthStore.setState({ user: { id: "u1" } as never, subscription: null });
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

  it("disconnects a local connection after confirming", async () => {
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "local" });
    render(<GoogleIntegrationSettings />);
    await screen.findByText("Connected with your own OAuth client");
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Disconnect",
      }),
    );
    expect(mocks.googleDisconnectLocal).toHaveBeenCalled();
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });

  it("connects with a local client and reports success", async () => {
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    let finish!: () => void;
    mocks.googleOAuthComplete.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<GoogleIntegrationSettings />);
    const id = screen.getByLabelText("Google OAuth client ID");
    await waitFor(() => expect(id).toHaveValue("saved-client"));
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(
      await screen.findByText("Waiting for Google sign-in in your browser…"),
    ).toBeInTheDocument();
    expect(openUrl).toHaveBeenCalledWith("https://accounts.google/x");
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "local" });
    finish();
    expect(
      await screen.findByText("Connected with your own OAuth client"),
    ).toBeInTheDocument();
    expect(toastTitles()).toContain("Google Workspace connected");
  });

  it("cancels a pending local sign-in without an error toast", async () => {
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "none" });
    let fail!: (e: unknown) => void;
    mocks.googleOAuthComplete.mockReturnValue(
      new Promise<void>((_, reject) => {
        fail = reject;
      }),
    );
    mocks.googleOAuthCancel.mockImplementation(async () => fail("cancelled"));
    render(<GoogleIntegrationSettings />);
    await userEvent.type(
      screen.getByLabelText("Google OAuth client ID"),
      "-typed",
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );
    expect(mocks.googleOAuthCancel).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByText("Waiting for Google sign-in in your browser…"),
      ).not.toBeInTheDocument(),
    );
    expect(toastTitles()).not.toContain("Google sign-in failed");
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
      expect(
        useToastStore.getState().toasts.map((t) => t.description),
      ).toContain("Pro plan required"),
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

  it("explains that a local client takes precedence over Pro", async () => {
    useAuthStore.setState({
      user: { id: "u1" } as never,
      subscription: { plan: "pro", status: "active" } as never,
    });
    mocks.googleConnectionStatus.mockResolvedValue({ mode: "local" });
    render(<GoogleIntegrationSettings />);
    expect(await screen.findByText(/takes precedence/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect with Google" }),
    ).toBeDisabled();
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
