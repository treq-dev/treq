import { render, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStoreEffects } from "./AppStoreEffects";
import { useAuthStore } from "./authStore";

type DeepLinkHandler = (event: { payload: string[] }) => Promise<void>;

// The desktop backend emits `deep-link-received` with `vec![url]`.
async function renderAndGetDeepLinkHandler(): Promise<DeepLinkHandler> {
  render(<AppStoreEffects />);
  await waitFor(() =>
    expect(listen).toHaveBeenCalledWith(
      "deep-link-received",
      expect.any(Function),
    ),
  );
  const calls = vi
    .mocked(listen)
    .mock.calls.filter(([event]) => event === "deep-link-received");
  expect(calls).toHaveLength(1);
  return calls[0][1] as unknown as DeepLinkHandler;
}

describe("AppStoreEffects deep links", () => {
  const originalExchangeToken = useAuthStore.getState().exchangeToken;
  const exchangeToken = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.mocked(listen).mockClear();
    exchangeToken.mockClear();
    useAuthStore.setState({ exchangeToken });
  });

  afterEach(() => {
    useAuthStore.setState({ exchangeToken: originalExchangeToken });
  });

  it("exchanges the token from an auth callback once", async () => {
    const onDeepLink = await renderAndGetDeepLinkHandler();

    await onDeepLink({ payload: ["treq://auth/callback?token=abc"] });

    expect(exchangeToken).toHaveBeenCalledOnce();
    expect(exchangeToken).toHaveBeenCalledWith("abc");
  });

  it("does not exchange anything for an agent deep link", async () => {
    const onDeepLink = await renderAndGetDeepLinkHandler();

    await onDeepLink({ payload: ["treq://agent/start?repo=%2Ftmp%2Frepo"] });

    expect(exchangeToken).not.toHaveBeenCalled();
  });
});
