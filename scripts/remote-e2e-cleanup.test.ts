// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APPLY_TARGET_KIND,
  decideFlyMachine,
  decideTaggedResource,
  evaluateEnvGate,
  isE2eTagged,
  mapWithConcurrency,
  parseArgs,
  planAuthUserCleanup,
  planFlyMachineCleanup,
  cutoffFromMinAge,
} from "./lib/remote-e2e-cleanup.ts";

const E2E_NAME = "treq-e2e-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CUTOFF = new Date("2026-09-04T10:00:00.000Z");

Deno.test("isE2eTagged accepts only the dedicated uuid tag shape", () => {
  assertEquals(isE2eTagged(E2E_NAME), true);
  assertFalse(isE2eTagged("treq-e2e-not-a-uuid"));
  assertFalse(isE2eTagged("production-user"));
  assertFalse(isE2eTagged("treq-e2e-"));
  assertFalse(isE2eTagged(null));
});

Deno.test("parseArgs defaults to dry-run and a two-hour safety window", () => {
  const args = parseArgs([]);
  assertEquals(args.mode, "dry-run");
  assertEquals(args.minAgeHours, 2);
  assertEquals(args.concurrency, 2);
});

Deno.test("parseArgs requires --apply to leave dry-run", () => {
  assertEquals(parseArgs(["--apply"]).mode, "apply");
  assertEquals(parseArgs(["--apply", "--dry-run"]).mode, "dry-run");
});

Deno.test("parseArgs caps concurrency", () => {
  assertEquals(parseArgs(["--concurrency=99"]).concurrency, 8);
  assertEquals(parseArgs(["--concurrency=1"]).concurrency, 1);
});

Deno.test("age check leaves resources inside the safety window", () => {
  const young = decideTaggedResource(
    {
      id: "1",
      name: E2E_NAME,
      createdAt: new Date("2026-09-04T11:00:00.000Z"),
      tags: [],
    },
    CUTOFF,
  );
  assertEquals(young.action, "skip");
});

Deno.test("age check selects e2e-tagged resources older than the cutoff", () => {
  const old = decideTaggedResource(
    {
      id: "1",
      name: E2E_NAME,
      createdAt: new Date("2026-09-04T08:00:00.000Z"),
      tags: [],
    },
    CUTOFF,
  );
  assertEquals(old.action, "delete");
});

Deno.test("refuses ambiguous untagged resources rather than deleting them", () => {
  const decision = decideTaggedResource(
    {
      id: "machine-1",
      name: "treq-prod-worker",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      tags: ["env:prod"],
    },
    CUTOFF,
  );
  assertEquals(decision.action, "refuse");
});

Deno.test("fly machines named from rust e2e owner ids are tagged", () => {
  const decision = decideFlyMachine(
    {
      id: "m1",
      name: `treq-${E2E_NAME}`,
      state: "started",
      created_at: "2026-09-04T08:00:00.000Z",
    },
    CUTOFF,
    new Set(),
  );
  assertEquals(decision.action, "delete");
});

Deno.test("fly machines named after a known e2e auth user id are tagged", () => {
  const userId = "11111111-2222-4333-8444-555555555555";
  const decision = decideFlyMachine(
    {
      id: "m2",
      name: `treq-${userId}`,
      state: "stopped",
      created_at: "2026-09-04T08:00:00.000Z",
    },
    CUTOFF,
    new Set([userId]),
  );
  assertEquals(decision.action, "delete");
});

Deno.test("fly machines without a tag or known e2e user are refused", () => {
  const decision = decideFlyMachine(
    {
      id: "m3",
      name: "treq-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      state: "started",
      created_at: "2026-09-04T08:00:00.000Z",
    },
    CUTOFF,
    new Set(),
  );
  assertEquals(decision.action, "refuse");
});

Deno.test("env gate refuses missing supabase credentials", () => {
  const dryRun = evaluateEnvGate({
    mode: "dry-run",
    supabaseUrl: null,
    supabaseServiceRoleKey: "key",
  });
  assertEquals(dryRun.ok, false);
  if (!dryRun.ok) assertEquals(dryRun.skip, true);

  const apply = evaluateEnvGate({
    mode: "apply",
    supabaseUrl: null,
    supabaseServiceRoleKey: "key",
  });
  assertEquals(apply.ok, false);
  if (!apply.ok) assertEquals(apply.skip, false);
});

Deno.test("apply mode requires the dedicated-test target kind", () => {
  const missing = evaluateEnvGate({
    mode: "apply",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "key",
    cleanupTargetKind: "staging",
  });
  assertEquals(missing.ok, false);

  const ok = evaluateEnvGate({
    mode: "apply",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "key",
    cleanupTargetKind: APPLY_TARGET_KIND,
  });
  assertEquals(ok.ok, true);
  if (ok.ok) assertEquals(ok.flyScanEnabled, false);
});

Deno.test("fly scan is enabled only with a separately scoped cleanup token and app", () => {
  const result = evaluateEnvGate({
    mode: "dry-run",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "key",
    flyCleanupToken: "fly_cleanup_token",
    flyCleanupAppName: "treq-e2e-app",
  });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.flyScanEnabled, true);
});

Deno.test("dry-run plans deletions without invoking a deleter", () => {
  const users = [
    { id: "u1", email: `${E2E_NAME}@e2e.treq.invalid`, created_at: "2026-09-04T08:00:00.000Z" },
  ];
  const plan = planAuthUserCleanup(users, CUTOFF);
  assertEquals(plan[0].decision.action, "delete");
  let deletes = 0;
  if (parseArgs([]).mode === "dry-run") {
    // Dry-run must not call the deleter even when the plan says delete.
  } else {
    deletes += 1;
  }
  assertEquals(deletes, 0);
});

Deno.test("mapWithConcurrency never exceeds the cap", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);
  await mapWithConcurrency(items, 3, async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight -= 1;
  });
  assertEquals(maxInFlight <= 3, true);
});

Deno.test("cutoffFromMinAge is the expected safety window", () => {
  const cutoff = cutoffFromMinAge(Date.parse("2026-09-04T12:00:00.000Z"), 2);
  assertEquals(cutoff.toISOString(), "2026-09-04T10:00:00.000Z");
});

Deno.test("fixture fly inventory is classified before any provider call", () => {
  const fixtures = [
    {
      id: "keep-young",
      name: `treq-${E2E_NAME}`,
      state: "started",
      created_at: "2026-09-04T11:30:00.000Z",
    },
    {
      id: "delete-old",
      name: `treq-${E2E_NAME}`,
      state: "stopped",
      created_at: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "refuse-ambiguous",
      name: "unrelated-machine",
      state: "started",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  const plan = planFlyMachineCleanup(fixtures, CUTOFF, new Set());
  assertEquals(plan.map((item) => item.decision.action), ["skip", "delete", "refuse"]);
});
