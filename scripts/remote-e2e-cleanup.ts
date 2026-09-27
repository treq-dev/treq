#!/usr/bin/env -S deno run --allow-net --allow-env
// deno-lint-ignore-file no-import-prefix -- standalone script outside
// supabase/functions, so it has no import map to resolve a bare
// "@supabase/supabase-js" specifier against; an explicit https: import is
// the normal, supported way to depend on a package in a lone Deno script.
//
// Scheduled/standalone cleanup for leaked Remote SSH e2e test resources
// (prds/remote-development.md, Phase 8: "A scheduled cleanup job removes leaked test
// resources after a safety window.").
//
// Usage:
//   deno run --allow-net --allow-env scripts/remote-e2e-cleanup.ts [--dry-run] [--apply] [--min-age-hours=N] [--concurrency=N]
//
// Defaults to dry-run. `--apply` actually deletes, and also requires
// TREQ_REMOTE_E2E_CLEANUP_TARGET=dedicated-test.
//
// Required environment variables:
//   SUPABASE_TEST_URL
//   SUPABASE_TEST_SERVICE_ROLE_KEY
//
// Optional, separately scoped Sprites cleanup credentials for the dedicated
// test organization (never the product SPRITES_API_TOKEN, and not the
// live-test SPRITES_TEST_API_TOKEN):
//   SPRITES_E2E_CLEANUP_API_TOKEN
//   SPRITES_E2E_CLEANUP_API_URL    (default https://api.sprites.dev)
//
// Apply-mode gate:
//   TREQ_REMOTE_E2E_CLEANUP_TARGET=dedicated-test
//
// Safety:
//   - Only resources matching the dedicated `treq-e2e-<uuid>` tag, the
//     rust `dev-treq-treq-e2e-<uuid>` Sprite name, or a Sprite named after a
//     known e2e auth user id (`dev-treq-<uuid>`).
//   - Ambiguous untagged resources are refused, never deleted.
//   - Default 2-hour min age so an in-progress suite is not reaped.
//   - Concurrency is capped (default 2).
//   - Provider request ids are logged when present.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cutoffFromMinAge,
  evaluateEnvGate,
  isE2eTagged,
  emailLocalPart,
  mapWithConcurrency,
  parseArgs,
  planAuthUserCleanup,
  planSpriteCleanup,
  SPRITE_NAME_PREFIX,
  type SpriteFixture,
} from "./lib/remote-e2e-cleanup.ts";

async function main() {
  const args = parseArgs(Deno.args);
  const gate = evaluateEnvGate({
    mode: args.mode,
    supabaseUrl: Deno.env.get("SUPABASE_TEST_URL"),
    supabaseServiceRoleKey: Deno.env.get("SUPABASE_TEST_SERVICE_ROLE_KEY"),
    cleanupTargetKind: Deno.env.get("TREQ_REMOTE_E2E_CLEANUP_TARGET"),
    spritesCleanupToken: Deno.env.get("SPRITES_E2E_CLEANUP_API_TOKEN"),
  });
  if (!gate.ok) {
    if (gate.skip) {
      console.log(`remote-e2e-cleanup: SKIP: ${gate.reason}`);
      return;
    }
    console.error(`remote-e2e-cleanup: ${gate.reason}`);
    Deno.exit(1);
  }

  const url = Deno.env.get("SUPABASE_TEST_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_TEST_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, serviceRoleKey);
  const cutoff = cutoffFromMinAge(Date.now(), args.minAgeHours);

  console.log(
    `remote-e2e-cleanup: scanning for e2e-tagged resources older than ${cutoff.toISOString()} ` +
      `(min age ${args.minAgeHours}h, concurrency ${args.concurrency}) [${args.mode}]`,
  );

  const e2eUserIds = new Set<string>();
  const e2eUsers: Array<{ id: string; email?: string | null; created_at: string }> = [];
  let page = 0;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: page + 1, perPage });
    if (error) {
      console.error(`remote-e2e-cleanup: failed to list users: ${error.message}`);
      Deno.exit(1);
    }
    if (!data.users || data.users.length === 0) break;
    for (const user of data.users) {
      const local = emailLocalPart(user.email ?? "");
      if (isE2eTagged(local)) {
        e2eUserIds.add(user.id.toLowerCase());
        e2eUsers.push({ id: user.id, email: user.email, created_at: user.created_at });
      }
    }
    if (data.users.length < perPage) break;
    page += 1;
  }

  const userPlan = planAuthUserCleanup(e2eUsers, cutoff);
  let deletedUsers = 0;
  let skippedUsers = 0;
  let refusedUsers = 0;

  const deletableUsers = userPlan.filter((item) => item.decision.action === "delete");
  for (const item of userPlan) {
    if (item.decision.action === "skip") {
      skippedUsers += 1;
      console.log(`  SKIP user ${item.label} (${item.decision.reason})`);
    } else if (item.decision.action === "refuse") {
      refusedUsers += 1;
      console.error(`  REFUSE user ${item.label}: ${item.decision.reason}`);
    }
  }

  await mapWithConcurrency(deletableUsers, args.concurrency, async (item) => {
    console.log(`  ${args.mode === "dry-run" ? "WOULD DELETE" : "DELETING"} test user ${item.label} (id=${item.id})`);
    if (args.mode === "apply") {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(item.id);
      if (deleteError) {
        console.error(`    FAILED to delete ${item.label}: ${deleteError.message}`);
        return;
      }
    }
    deletedUsers += 1;
  });

  console.log(
    `remote-e2e-cleanup: auth users planned=${userPlan.length} ` +
      `${args.mode === "dry-run" ? "would delete" : "deleted"}=${deletedUsers} skipped=${skippedUsers} refused=${refusedUsers}`,
  );

  if (!gate.spriteScanEnabled) {
    console.log(
      "remote-e2e-cleanup: SKIP Sprites scan: SPRITES_E2E_CLEANUP_API_TOKEN is not set. " +
        "This is a separately scoped cleanup credential, not SPRITES_TEST_API_TOKEN / SPRITES_API_TOKEN.",
    );
    return;
  }

  const spritesToken = Deno.env.get("SPRITES_E2E_CLEANUP_API_TOKEN")!;
  const spritesBase = (Deno.env.get("SPRITES_E2E_CLEANUP_API_URL") || "https://api.sprites.dev").replace(/\/+$/, "");
  const authHeaders = { Authorization: `Bearer ${spritesToken}` };
  const requestIdOf = (response: Response) =>
    response.headers.get("fly-request-id") ?? response.headers.get("x-request-id") ?? "";

  // Page through every Sprite Treq named, then let the pure planner decide
  // which of those are e2e-owned.
  const sprites: SpriteFixture[] = [];
  let continuation: string | undefined;
  for (;;) {
    const listUrl = new URL(`${spritesBase}/v1/sprites`);
    listUrl.searchParams.set("prefix", SPRITE_NAME_PREFIX);
    listUrl.searchParams.set("max_results", "500");
    if (continuation) listUrl.searchParams.set("continuation_token", continuation);
    const listResponse = await fetch(listUrl, { headers: authHeaders });
    console.log(
      `remote-e2e-cleanup: listed Sprites request_id=${requestIdOf(listResponse) || "(none)"} status=${listResponse.status}`,
    );
    if (!listResponse.ok) {
      console.error(`remote-e2e-cleanup: Sprites list failed: ${await listResponse.text()}`);
      Deno.exit(1);
    }
    const page = await listResponse.json();
    for (const raw of (Array.isArray(page?.sprites) ? page.sprites : []) as Record<string, unknown>[]) {
      sprites.push({
        id: raw.id === undefined ? undefined : String(raw.id),
        name: String(raw.name ?? ""),
        status: String(raw.status ?? ""),
        created_at: String(raw.created_at ?? new Date(0).toISOString()),
        labels: Array.isArray(raw.labels) ? raw.labels.map(String) : undefined,
      });
    }
    continuation = page?.has_more && typeof page.next_continuation_token === "string"
      ? page.next_continuation_token
      : undefined;
    if (!continuation) break;
  }

  const spritePlan = planSpriteCleanup(sprites, cutoff, e2eUserIds);
  let deletedSprites = 0;
  let skippedSprites = 0;
  let refusedSprites = 0;
  const deletableSprites = spritePlan.filter((item) => item.decision.action === "delete");
  for (const item of spritePlan) {
    if (item.decision.action === "skip") {
      skippedSprites += 1;
      console.log(`  SKIP sprite ${item.label} (${item.decision.reason})`);
    } else if (item.decision.action === "refuse") {
      refusedSprites += 1;
      console.error(`  REFUSE sprite ${item.label}: ${item.decision.reason}`);
    }
  }

  await mapWithConcurrency(deletableSprites, args.concurrency, async (item) => {
    console.log(
      `  ${args.mode === "dry-run" ? "WOULD DELETE" : "DELETING"} Sprite ${item.label}`,
    );
    if (args.mode === "apply") {
      const delResponse = await fetch(`${spritesBase}/v1/sprites/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      console.log(`    request_id=${requestIdOf(delResponse) || "(none)"} status=${delResponse.status}`);
      if (!delResponse.ok && delResponse.status !== 404) {
        console.error(`    FAILED to delete Sprite ${item.id}: ${await delResponse.text()}`);
        return;
      }
    }
    deletedSprites += 1;
  });

  console.log(
    `remote-e2e-cleanup: sprites scanned=${sprites.length} ` +
      `${args.mode === "dry-run" ? "would delete" : "deleted"}=${deletedSprites} skipped=${skippedSprites} refused=${refusedSprites}`,
  );
}

if (import.meta.main) {
  await main();
}
