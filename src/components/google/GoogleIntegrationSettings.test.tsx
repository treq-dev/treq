import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/test-utils";
import { useAuthStore } from "../../stores/authStore";
import { GoogleIntegrationSettings } from "./GoogleIntegrationSettings";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  googleConnectionStatus: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
  SUPABASE_URL: "https://proj.supabase.co",
}));
vi.mock("../../lib/google-proxy-auth", () => ({
  ensureGoogleProxySessionSync: () => Promise.resolve(),
}));
vi.mock("../../lib/api-google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-google")>()),
  googleConnectionStatus: mocks.googleConnectionStatus,
}));

describe("GoogleIntegrationSettings", () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue({
      data: { disconnected: true },
      error: null,
    });
    mocks.googleConnectionStatus
      .mockReset()
      .mockResolvedValue({ mode: "proxy", has_client_id: false });
  });

  it("disconnects the treq-held grant for a signed-in user", async () => {
    useAuthStore.setState({ user: { id: "u1" } as never, subscription: null });
    render(<GoogleIntegrationSettings />);
    expect(
      await screen.findByText("Connected through treq (Pro)"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect-google", {
      body: {},
    });
  });

  it("hides the treq disconnect when signed out", async () => {
    useAuthStore.setState({ user: null, subscription: null });
    mocks.googleConnectionStatus.mockResolvedValue({
      mode: "none",
      has_client_id: false,
    });
    render(<GoogleIntegrationSettings />);
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Disconnect" }),
    ).not.toBeInTheDocument();
  });
});
