// Request logic for complete-github-installation, free of Deno imports so it
// runs under service-qa. index.ts verifies the user's JWT and supplies the
// service-role store and the GitHub lookup.
//
// Linking requires Pro (prds/billing-and-teams.md, "Enforcement"). The check
// runs before the intent is consumed, so a user who upgrades can retry with
// the same unexpired intent. An installation already linked stays linked
// when Pro ends; only new links are refused.
//
// An installation that belongs to a Treq organization can only be relinked
// by an owner of that organization (github_link_installation in
// 028_organizations_team.sql). Any other installation keeps the old rule:
// the last user to link it owns it, and an owner can then attach it to an
// organization from the dashboard's Team tab.

import {
  PRO_REQUIRED_MESSAGES,
  proRequired,
} from "../_shared/billing/entitlement.ts";
import type { ServiceClientLike } from "../_shared/billing/store.ts";
import { type HandlerResult, sha256Hex } from "../_shared/intent-state.ts";

export type GitHubInstallation = {
  id: number;
  account: { login: string; type: string; avatar_url: string | null };
  app_id: number;
};

export type LinkResult = {
  result: "linked" | "organization_owner_required";
  organization_id: string | null;
};

export const ORGANIZATION_OWNER_REQUIRED =
  "This GitHub App installation belongs to a Treq organization. Only an owner of that organization can relink it.";

export interface InstallationLinkStore {
  /**
   * Consumes the caller's unexpired, unconsumed intent with this state hash.
   * Returns null when there is none.
   */
  consumeIntent(
    userId: string,
    stateHash: string,
    nowIso: string,
  ): Promise<{ id: string } | null>;
  linkInstallation(
    installation: GitHubInstallation,
    userId: string,
  ): Promise<LinkResult>;
}

export type CompleteInstallationDeps = {
  userId: string;
  hasPro: () => Promise<boolean>;
  store: InstallationLinkStore;
  /** App-authenticated lookup on GitHub; null when it does not exist. */
  getInstallation: (installationId: number) => Promise<GitHubInstallation | null>;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function completeInstallation(
  body: unknown,
  deps: CompleteInstallationDeps,
): Promise<HandlerResult> {
  const { installation_id, state } = (body ?? {}) as {
    installation_id?: unknown;
    state?: unknown;
  };
  const installationId = Number(installation_id);
  if (
    !Number.isInteger(installationId) ||
    installationId <= 0 ||
    typeof state !== "string" ||
    !state
  ) {
    return { status: 400, body: { error: "Missing installation_id or state" } };
  }

  if (!(await deps.hasPro())) {
    return proRequired(PRO_REQUIRED_MESSAGES.githubApp);
  }

  // Atomically consume the intent: single-use, unexpired, owned by the
  // caller. Consuming before the GitHub lookup prevents concurrent reuse.
  let intent: { id: string } | null;
  try {
    intent = await deps.store.consumeIntent(
      deps.userId,
      await sha256Hex(state),
      new Date().toISOString(),
    );
  } catch (err) {
    console.error("[complete-github-installation] intent lookup failed:", errorMessage(err));
    return { status: 500, body: { error: "Failed to verify install intent" } };
  }
  if (!intent) {
    return {
      status: 403,
      body: { error: "Install intent is invalid, expired or already used" },
    };
  }

  // Verify the installation actually exists for our app on GitHub's side.
  let installation: GitHubInstallation | null;
  try {
    installation = await deps.getInstallation(installationId);
  } catch (err) {
    console.error("[complete-github-installation] GitHub lookup failed:", errorMessage(err));
    return { status: 502, body: { error: "Failed to verify installation with GitHub" } };
  }
  if (!installation) {
    return { status: 404, body: { error: "Installation not found on GitHub" } };
  }

  let link: LinkResult;
  try {
    link = await deps.store.linkInstallation(installation, deps.userId);
  } catch (err) {
    console.error("[complete-github-installation] link failed:", errorMessage(err));
    return { status: 500, body: { error: "Failed to link installation" } };
  }
  if (link.result === "organization_owner_required") {
    console.log(
      JSON.stringify({
        operation: "installation_relink_refused",
        installation_id: installation.id,
        user_id: deps.userId,
      }),
    );
    return {
      status: 403,
      body: {
        error: ORGANIZATION_OWNER_REQUIRED,
        code: "organization_owner_required",
      },
    };
  }

  console.log(
    JSON.stringify({
      operation: "installation_linked",
      installation_id: installation.id,
      account_login: installation.account.login,
      user_id: deps.userId,
    }),
  );
  // The callback page sends a GitHub organization's installation that no
  // Treq organization owns yet to the Team tab, where an owner attaches it.
  return {
    status: 200,
    body: {
      ok: true,
      account_login: installation.account.login,
      account_type: installation.account.type,
      organization_id: link.organization_id,
    },
  };
}

export function installationLinkStore(
  client: ServiceClientLike,
): InstallationLinkStore {
  return {
    async consumeIntent(userId, stateHash, nowIso) {
      const { data, error } = await client
        .from("github_install_intents")
        .update({ consumed_at: nowIso })
        .eq("state_hash", stateHash)
        .eq("user_id", userId)
        .is("consumed_at", null)
        .gte("expires_at", nowIso)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { id: string } | null) ?? null;
    },
    async linkInstallation(installation, userId) {
      const { data, error } = await client.rpc("github_link_installation", {
        p_actor: userId,
        p_installation_id: installation.id,
        p_account_login: installation.account.login,
        p_account_type: installation.account.type,
        p_account_avatar_url: installation.account.avatar_url ?? null,
        p_app_id: installation.app_id,
      });
      if (error) throw new Error(error.message);
      return data as LinkResult;
    },
  };
}
