import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAuthState, useAuthStore } from "../stores/authStore";
import { useToastStore } from "../stores/toastStore";
import { LinearIntegrationSettings } from "./LinearIntegrationSettings";

const { invokeEdgeFn } = vi.hoisted(() => ({ invokeEdgeFn: vi.fn() }));

vi.mock("../lib/supabase", () => ({
  supabase: { functions: { invoke: invokeEdgeFn } },
}));

vi.mock("../lib/api-linear", () => ({
  getLinearApiKey: vi.fn().mockResolvedValue(null),
  setLinearApiKey: vi.fn(),
  getLinearAutoKickoffLabel: vi.fn().mockResolvedValue(null),
  setLinearAutoKickoffLabel: vi.fn(),
  linearStartAutoKickoffPolling: vi.fn(),
}));

const AUTHORIZATION_URL =
  "https://linear.app/oauth/authorize?client_id=abc&state=def";

describe("LinearIntegrationSettings OAuth connect", () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockClear();
    useAuthStore.setState({
      ...defaultAuthState,
      loading: false,
      subscription: {
        plan: "pro",
        status: "active",
        current_period_end: null,
      },
    });
  });

  it("opens the authorization_url returned by create-linear-oauth-intent", async () => {
    // Same body as supabase/functions/create-linear-oauth-intent/index.ts.
    invokeEdgeFn.mockResolvedValue({
      data: {
        authorization_url: AUTHORIZATION_URL,
        expires_at: "2026-01-01T00:15:00.000Z",
      },
      error: null,
    });
    render(<LinearIntegrationSettings repoPath="/repo" />);

    await userEvent.click(
      screen.getByRole("button", { name: "Connect via OAuth" }),
    );

    expect(invokeEdgeFn).toHaveBeenCalledWith("create-linear-oauth-intent", {
      body: {},
    });
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith(AUTHORIZATION_URL),
    );
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
