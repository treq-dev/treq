import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ supabase: { auth } }));

import { useAuthStore } from "./authStore";
import { useRemoteCutoffStore } from "./remoteCutoffStore";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  auth.signOut.mockReset().mockResolvedValue({ error: null });
  auth.onAuthStateChange
    .mockReset()
    .mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});

describe("sign-out cutoff of managed endpoints", () => {
  it("cuts off managed endpoints before ending the session", async () => {
    const order: string[] = [];
    vi.mocked(invoke).mockImplementation(async (command) => {
      order.push(command);
    });
    auth.signOut.mockImplementation(async () => {
      order.push("supabase.signOut");
      return { error: null };
    });

    await useAuthStore.getState().signOut();

    expect(order.slice(0, 2)).toEqual([
      "remote_cut_off_managed",
      "supabase.signOut",
    ]);
  });

  it("cuts off managed endpoints when the session ends on its own", async () => {
    await useRemoteCutoffStore.getState().startListening();
    const onEvent = auth.onAuthStateChange.mock.calls[0][0] as (
      event: string,
    ) => void;

    onEvent("TOKEN_REFRESHED");
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalledWith("remote_cut_off_managed");

    onEvent("SIGNED_OUT");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("remote_cut_off_managed"),
    );
    useRemoteCutoffStore.getState().stopListening();
  });
});
