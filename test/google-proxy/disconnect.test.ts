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

  it("deletes the row before revoking", async () => {
    const order: string[] = [];
    const deps = {
      store: {
        load: async () => ({ access_token: "a", refresh_token: "r" }),
        remove: vi.fn(async () => {
          order.push("remove");
        }),
      },
      fetch: (async () => {
        order.push("revoke");
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
    };
    await disconnectGoogle(deps);
    expect(order).toEqual(["remove", "revoke"]);
  });

  it("does not hang when the revoke never settles", async () => {
    const remove = vi.fn(async () => {});
    const result = await disconnectGoogle({
      store: {
        load: async () => ({ access_token: "a", refresh_token: "r" }),
        remove,
      },
      fetch: (() => new Promise<Response>(() => {})) as unknown as typeof fetch,
      revokeTimeoutMs: 20,
    });
    expect(result.body).toEqual({ disconnected: true, revoked: false });
    expect(remove).toHaveBeenCalledOnce();
  });

  it("passes an abort signal to the revoke", async () => {
    const { deps, fetchMock } = setup({
      access_token: "a",
      refresh_token: "r",
    });
    await disconnectGoogle(deps);
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails without revoking when the delete fails", async () => {
    const { fetchMock, deps } = setup({
      access_token: "a",
      refresh_token: "r",
    });
    deps.store.remove = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(disconnectGoogle(deps)).rejects.toThrow("db down");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
