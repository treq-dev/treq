#!/usr/bin/env -S deno run --allow-net --allow-env
// deno-lint-ignore-file no-import-prefix -- standalone script outside
// supabase/functions, so it has no import map to resolve a bare
// "@supabase/supabase-js" specifier against; an explicit https: import is
// the normal, supported way to depend on a package in a lone Deno script.
//
// Scheduled/standalone cleanup for leaked Remote SSH e2e test resources
// (prds/remote-ssh.md, Phase 8: "A scheduled cleanup job removes leaked test
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
// Optional, separately scoped Fly cleanup credentials (never the product
// FLY_SPRITES_API_TOKEN, and not the live-test FLY_TEST_API_TOKEN):
//   FLY_E2E_CLEANUP_API_TOKEN
//   FLY_E2E_CLEANUP_APP_NAME
//   FLY_E2E_CLEANUP_API_BASE_URL   (default https://api.machines.dev/v1)
//
// Apply-mode gate:
//   TREQ_REMOTE_E2E_CLEANUP_TARGET=dedicated-test
//
// Safety:
//   - Only resources matching the dedicated `treq-e2e-<uuid>` tag, the
//     rust `treq-treq-e2e-<uuid>` machine name, or a machine named after a
//     known e2e auth user id.
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
  planFlyMachineCleanup,
  type FlyMachineFixture,
} from "./lib/remote-e2e-cleanup.ts";

async function main() {
  const args = parseArgs(Deno.args);
  const gate = evaluateEnvGate({
    mode: args.mode,
    supabaseUrl: Deno.env.get("SUPABASE_TEST_URL"),
    supabaseServiceRoleKey: Deno.env.get("SUPABASE_TEST_SERVICE_ROLE_KEY"),
    cleanupTargetKind: Deno.env.get("TREQ_REMOTE_E2E_CLEANUP_TARGET"),
    flyCleanupToken: Deno.env.get("FLY_E2E_CLEANUP_API_TOKEN"),
    flyCleanupAppName: Deno.env.get("FLY_E2E_CLEANUP_APP_NAME"),
    flyCleanupBaseUrl: Deno.env.get("FLY_E2E_CLEANUP_API_BASE_URL"),
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

  if (!gate.flyScanEnabled) {
    console.log(
      "remote-e2e-cleanup: SKIP Fly provider scan: FLY_E2E_CLEANUP_API_TOKEN and FLY_E2E_CLEANUP_APP_NAME are not both set. " +
        "This is a separately scoped cleanup credential, not FLY_TEST_API_TOKEN / FLY_SPRITES_API_TOKEN.",
    );
    return;
  }

  const flyToken = Deno.env.get("FLY_E2E_CLEANUP_API_TOKEN")!;
  const flyApp = Deno.env.get("FLY_E2E_CLEANUP_APP_NAME")!;
  const flyBase = Deno.env.get("FLY_E2E_CLEANUP_API_BASE_URL") ?? "https://api.machines.dev/v1";
  const listUrl = `${flyBase.replace(/\/$/, "")}/apps/${encodeURIComponent(flyApp)}/machines`;
  const listResponse = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${flyToken}` },
  });
  const listRequestId = listResponse.headers.get("fly-request-id") ?? listResponse.headers.get("x-request-id") ?? "";
  console.log(`remote-e2e-cleanup: listed Fly machines request_id=${listRequestId || "(none)"} status=${listResponse.status}`);
  if (!listResponse.ok) {
    console.error(`remote-e2e-cleanup: Fly list failed: ${await listResponse.text()}`);
    Deno.exit(1);
  }
  const listed = await listResponse.json();
  const machines: FlyMachineFixture[] = (Array.isArray(listed) ? listed : []).map((raw: Record<string, unknown>) => ({
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    state: String(raw.state ?? ""),
    created_at: String(raw.created_at ?? raw.createdAt ?? new Date(0).toISOString()),
    metadata: (raw.config as { metadata?: Record<string, string> } | undefined)?.metadata,
  }));

  const machinePlan = planFlyMachineCleanup(machines, cutoff, e2eUserIds);
  let deletedMachines = 0;
  let skippedMachines = 0;
  let refusedMachines = 0;
  const deletableMachines = machinePlan.filter((item) => item.decision.action === "delete");
  for (const item of machinePlan) {
    if (item.decision.action === "skip") {
      skippedMachines += 1;
      console.log(`  SKIP machine ${item.label} (${item.decision.reason})`);
    } else if (item.decision.action === "refuse") {
      refusedMachines += 1;
      console.error(`  REFUSE machine ${item.label}: ${item.decision.reason}`);
    }
  }

  await mapWithConcurrency(deletableMachines, args.concurrency, async (item) => {
    console.log(
      `  ${args.mode === "dry-run" ? "WOULD DELETE" : "DELETING"} Fly machine ${item.label}`,
    );
    if (args.mode === "apply") {
      const delUrl = `${flyBase.replace(/\/$/, "")}/apps/${encodeURIComponent(flyApp)}/machines/${encodeURIComponent(item.id)}?force=true`;
      const delResponse = await fetch(delUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${flyToken}` },
      });
      const requestId = delResponse.headers.get("fly-request-id") ?? delResponse.headers.get("x-request-id") ?? "";
      console.log(`    fly-request-id=${requestId || "(none)"} status=${delResponse.status}`);
      if (!delResponse.ok && delResponse.status !== 404) {
        console.error(`    FAILED to delete machine ${item.id}: ${await delResponse.text()}`);
        return;
      }
    }
    deletedMachines += 1;
  });

  console.log(
    `remote-e2e-cleanup: fly machines scanned=${machines.length} ` +
      `${args.mode === "dry-run" ? "would delete" : "deleted"}=${deletedMachines} skipped=${skippedMachines} refused=${refusedMachines}`,
  );
}

if (import.meta.main) {
  await main();
}
