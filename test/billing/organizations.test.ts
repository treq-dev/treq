import { describe, expect, it, vi } from "vitest";
import {
  handleOrganizationsRequest,
  inviteAcceptUrl,
  type OrganizationsDeps,
  type RpcResult,
} from "../../supabase/functions/organizations/lib.ts";

const USER_ID = "6f1c1f4e-6a8f-4a39-9d55-2b1f0b3f9a10";
const ORG_ID = "0b8d3f0e-2c1a-4f5e-9d7b-6a4c3e2f1a00";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "a".repeat(64);

type RpcCall = { fn: string; args: Record<string, unknown> };

function deps(result: RpcResult = { data: null, error: null }) {
  const calls: RpcCall[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return result;
  });
  return {
    calls,
    deps: {
      userId: USER_ID,
      rpc,
      webUrl: "https://treq.dev/",
    } satisfies OrganizationsDeps,
  };
}

describe("inviteAcceptUrl", () => {
  it("points at the Team tab with the token in the fragment, not the query", () => {
    const url = new URL(inviteAcceptUrl("https://treq.dev/", TOKEN));
    expect(url.href).toBe(
      `https://treq.dev/dashboard?tab=team#invite=${TOKEN}`,
    );
    expect(url.search).toBe("?tab=team");
  });
});

describe("handleOrganizationsRequest", () => {
  it("rejects an unknown action before calling Postgres", async () => {
    const { calls, deps: d } = deps();
    const result = await handleOrganizationsRequest({ action: "promote" }, d);
    expect(result.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it.each([
    [{ action: "create" }],
    [{ action: "invite", organization_id: ORG_ID }],
    [{ action: "invite", organization_id: "acme", email: "a@b.co" }],
    [{ action: "accept" }],
    [{ action: "revoke_invite", invite_id: 7 }],
    [{ action: "remove_member", organization_id: ORG_ID }],
    [{ action: "leave" }],
    [
      {
        action: "attach_installation",
        organization_id: ORG_ID,
        installation_id: -1,
      },
    ],
    [
      {
        action: "attach_installation",
        organization_id: ORG_ID,
        installation_id: "12",
      },
    ],
  ])("rejects missing or malformed fields: %j", async (body) => {
    const { calls, deps: d } = deps();
    const result = await handleOrganizationsRequest(body, d);
    expect(result.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("creates an organization owned by the caller", async () => {
    const { calls, deps: d } = deps({
      data: { id: ORG_ID, name: "Acme" },
      error: null,
    });
    const result = await handleOrganizationsRequest(
      { action: "create", name: "Acme" },
      d,
    );
    expect(calls).toEqual([
      { fn: "organization_create", args: { p_actor: USER_ID, p_name: "Acme" } },
    ]);
    expect(result).toEqual({
      status: 200,
      body: { organization: { id: ORG_ID, name: "Acme" } },
    });
  });

  it("returns an invite's accept URL and never the bare token", async () => {
    const { calls, deps: d } = deps({
      data: {
        invite_id: OTHER_ID,
        email: "mia@example.com",
        expires_at: "2026-10-12T00:00:00Z",
        token: TOKEN,
      },
      error: null,
    });
    const result = await handleOrganizationsRequest(
      { action: "invite", organization_id: ORG_ID, email: "Mia@Example.com" },
      d,
    );
    expect(calls).toEqual([
      {
        fn: "organization_invite",
        args: {
          p_actor: USER_ID,
          p_org_id: ORG_ID,
          p_email: "Mia@Example.com",
        },
      },
    ]);
    expect(result).toEqual({
      status: 200,
      body: {
        invite: {
          id: OTHER_ID,
          email: "mia@example.com",
          expires_at: "2026-10-12T00:00:00Z",
        },
        accept_url: `https://treq.dev/dashboard?tab=team#invite=${TOKEN}`,
      },
    });
  });

  it("accepts an invite by token for the caller", async () => {
    const { calls, deps: d } = deps({
      data: { organization_id: ORG_ID, name: "Acme", result: "joined" },
      error: null,
    });
    const result = await handleOrganizationsRequest(
      { action: "accept", token: TOKEN },
      d,
    );
    expect(calls).toEqual([
      {
        fn: "organization_accept_invite",
        args: { p_actor: USER_ID, p_token: TOKEN },
      },
    ]);
    expect(result).toEqual({
      status: 200,
      body: { organization: { id: ORG_ID, name: "Acme" }, result: "joined" },
    });
  });

  it.each([
    [
      { action: "revoke_invite", invite_id: OTHER_ID },
      "organization_revoke_invite",
      { p_actor: USER_ID, p_invite_id: OTHER_ID },
    ],
    [
      { action: "remove_member", organization_id: ORG_ID, user_id: OTHER_ID },
      "organization_remove_member",
      { p_actor: USER_ID, p_org_id: ORG_ID, p_user_id: OTHER_ID },
    ],
    [
      { action: "leave", organization_id: ORG_ID },
      "organization_leave",
      { p_actor: USER_ID, p_org_id: ORG_ID },
    ],
  ])("%j calls %s as the caller", async (body, fn, args) => {
    const { calls, deps: d } = deps();
    const result = await handleOrganizationsRequest(body, d);
    expect(calls).toEqual([{ fn, args }]);
    expect(result).toEqual({ status: 200, body: { ok: true } });
  });

  it("attaches an installation", async () => {
    const { calls, deps: d } = deps({ data: "attached", error: null });
    const result = await handleOrganizationsRequest(
      {
        action: "attach_installation",
        organization_id: ORG_ID,
        installation_id: 4242,
      },
      d,
    );
    expect(calls).toEqual([
      {
        fn: "organization_attach_installation",
        args: { p_actor: USER_ID, p_org_id: ORG_ID, p_installation_id: 4242 },
      },
    ]);
    expect(result).toEqual({
      status: 200,
      body: { ok: true, result: "attached" },
    });
  });

  it.each([
    ["PT400", 400],
    ["PT403", 403],
    ["PT404", 404],
    ["PT409", 409],
    ["PT410", 410],
  ])("answers a %s refusal with HTTP %i and its code", async (code, status) => {
    const { deps: d } = deps({
      data: null,
      error: { message: "A Team covers 10 members.", code, hint: "seat_limit" },
    });
    const result = await handleOrganizationsRequest(
      { action: "invite", organization_id: ORG_ID, email: "x@example.com" },
      d,
    );
    expect(result).toEqual({
      status,
      body: { error: "A Team covers 10 members.", code: "seat_limit" },
    });
  });

  it("hides any other database error behind a 500", async () => {
    const { deps: d } = deps({
      data: null,
      error: { message: "relation does not exist", code: "42P01", hint: null },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await handleOrganizationsRequest(
      { action: "leave", organization_id: ORG_ID },
      d,
    );
    expect(result).toEqual({
      status: 500,
      body: { error: "Organization request failed" },
    });
    log.mockRestore();
  });
});
