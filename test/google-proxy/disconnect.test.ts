import { describe, expect, it, vi } from "vitest";
import {
  disconnectGoogle,
  type StoredGrant,
} from "../../supabase/functions/disconnect-google/lib.ts";

function setup(grant: StoredGrant | null, revokeStatus = 200) {
  const remove = vi.fn(async () => {});
  const fetchMock = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response("", { status: revokeStatus }),
  );
  return {
    remove,
    fetchMock,
    deps: {
      store: { load: async () => grant, remove },
      fetch: fetchMock as unknown as typeof fetch,
    },
  };
}

describe("disconnectGoogle", () => {
  it("revokes the refresh token and deletes the grant", async () => {
    const { deps, remove, fetchMock } = setup({
      access_token: "ya29.a",
      refresh_token: "1//r",
    });
    const result = await disconnectGoogle(deps);
    expect(result.body).toEqual({ disconnected: true, revoked: true });
    expect(String(fetchMock.mock.calls[0][1]?.body)).toBe("token=1%2F%2Fr");
    expect(remove).toHaveBeenCalledOnce();
  });

  it("deletes the grant even when Google refuses the revoke", async () => {
    const { deps, remove } = setup(
      { access_token: "a", refresh_token: null },
      400,
    );
    expect((await disconnectGoogle(deps)).body).toEqual({
      disconnected: true,
      revoked: false,
    });
    expect(remove).toHaveBeenCalledOnce();
  });

  it("is a no-op without a grant", async () => {
    const { deps, remove, fetchMock } = setup(null);
    expect((await disconnectGoogle(deps)).body).toEqual({
      disconnected: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
