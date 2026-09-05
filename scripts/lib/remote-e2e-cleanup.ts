// Pure helpers for scheduled Remote SSH e2e orphan cleanup.
// Kept free of Deno CLI side effects so unit tests can exercise filtering,
// age checks, dry-run, concurrency, and environment gates against fixtures
// without any provider or Supabase call.

export const E2E_TAG_PREFIX = "treq-e2e-";
export const E2E_TAG_PATTERN = /^treq-e2e-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEFAULT_MIN_AGE_HOURS = 2;
export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 8;
export const APPLY_TARGET_KIND = "dedicated-test";

export type CleanupMode = "dry-run" | "apply";

export interface CleanupArgs {
  mode: CleanupMode;
  minAgeHours: number;
  concurrency: number;
}

export interface EnvGateInput {
  mode: CleanupMode;
  supabaseUrl?: string | null;
  supabaseServiceRoleKey?: string | null;
  cleanupTargetKind?: string | null;
  flyCleanupToken?: string | null;
  flyCleanupAppName?: string | null;
  flyCleanupBaseUrl?: string | null;
}

export type EnvGateResult =
  | { ok: true; flyScanEnabled: boolean }
  | { ok: false; reason: string; skip?: boolean };

export interface TaggedResource {
  id: string;
  name: string;
  createdAt: Date;
  tags: string[];
}

export type DeleteDecision =
  | { action: "delete"; reason: string }
  | { action: "skip"; reason: string }
  | { action: "refuse"; reason: string };

export interface FlyMachineFixture {
  id: string;
  name: string;
  state: string;
  created_at: string;
  request_id?: string;
  metadata?: Record<string, string>;
}

export function isE2eTagged(value: string | null | undefined): boolean {
  if (!value) return false;
  return E2E_TAG_PATTERN.test(value.trim());
}

export function emailLocalPart(email: string): string {
  return email.split("@")[0] ?? "";
}

export function parseArgs(argv: string[]): CleanupArgs {
  let mode: CleanupMode = "dry-run";
  let minAgeHours = DEFAULT_MIN_AGE_HOURS;
  let concurrency = DEFAULT_CONCURRENCY;
  for (const arg of argv) {
    if (arg === "--dry-run") mode = "dry-run";
    else if (arg === "--apply") mode = "apply";
    else if (arg.startsWith("--min-age-hours=")) {
      const parsed = Number(arg.split("=")[1]);
      if (Number.isFinite(parsed) && parsed >= 0) minAgeHours = parsed;
    } else if (arg.startsWith("--concurrency=")) {
      const parsed = Number(arg.split("=")[1]);
      if (Number.isFinite(parsed) && parsed >= 1) {
        concurrency = Math.min(Math.floor(parsed), MAX_CONCURRENCY);
      }
    }
  }
  return { mode, minAgeHours, concurrency };
}

export function cutoffFromMinAge(nowMs: number, minAgeHours: number): Date {
  return new Date(nowMs - minAgeHours * 60 * 60 * 1000);
}

export function isOlderThanCutoff(createdAt: Date, cutoff: Date): boolean {
  return createdAt.getTime() <= cutoff.getTime();
}

export function evaluateEnvGate(input: EnvGateInput): EnvGateResult {
  if (!input.supabaseUrl || !input.supabaseServiceRoleKey) {
    return {
      ok: false,
      reason:
        "SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY must be set. Refusing to run against an unspecified project.",
      skip: input.mode === "dry-run",
    };
  }
  if (input.mode === "apply") {
    if (input.cleanupTargetKind !== APPLY_TARGET_KIND) {
      return {
        ok: false,
        reason:
          `apply mode requires TREQ_REMOTE_E2E_CLEANUP_TARGET=${APPLY_TARGET_KIND} so cleanup cannot run against an unnamed or production project.`,
      };
    }
  }
  const flyScanEnabled = Boolean(input.flyCleanupToken && input.flyCleanupAppName);
  return { ok: true, flyScanEnabled };
}

export function flyMachineE2eName(name: string): boolean {
  // Rust adapter tests name machines `treq-{owner}` where owner is `treq-e2e-<uuid>`.
  const rustOwned = name.match(/^treq-(treq-e2e-[0-9a-f-]{36})$/i);
  if (rustOwned && isE2eTagged(rustOwned[1])) return true;
  return false;
}

export function flyMachineMatchesKnownE2eUser(name: string, e2eUserIds: Set<string>): boolean {
  const match = name.match(/^treq-([0-9a-f-]{36})$/i);
  if (!match) return false;
  return e2eUserIds.has(match[1].toLowerCase());
}

export function decideTaggedResource(
  resource: TaggedResource,
  cutoff: Date,
  e2eUserIds: Set<string> = new Set(),
): DeleteDecision {
  const tagged = isE2eTagged(resource.name) ||
    resource.tags.some((tag) => isE2eTagged(tag)) ||
    flyMachineE2eName(resource.name) ||
    flyMachineMatchesKnownE2eUser(resource.name, e2eUserIds);

  if (!tagged) {
    return {
      action: "refuse",
      reason: `ambiguous resource ${resource.id} name=${resource.name}: no dedicated e2e tag`,
    };
  }
  if (!isOlderThanCutoff(resource.createdAt, cutoff)) {
    return { action: "skip", reason: "within safety window" };
  }
  return { action: "delete", reason: "e2e-tagged and older than min age" };
}

export function decideFlyMachine(
  machine: FlyMachineFixture,
  cutoff: Date,
  e2eUserIds: Set<string>,
): DeleteDecision {
  return decideTaggedResource(
    {
      id: machine.id,
      name: machine.name,
      createdAt: new Date(machine.created_at),
      tags: Object.values(machine.metadata ?? {}),
    },
    cutoff,
    e2eUserIds,
  );
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, MAX_CONCURRENCY));
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export interface CleanupPlanItem {
  kind: "auth_user" | "fly_machine";
  id: string;
  label: string;
  decision: DeleteDecision;
}

export function planAuthUserCleanup(
  users: Array<{ id: string; email?: string | null; created_at: string }>,
  cutoff: Date,
): CleanupPlanItem[] {
  return users.map((user) => {
    const email = user.email ?? "";
    const local = emailLocalPart(email);
    const decision = decideTaggedResource(
      { id: user.id, name: local, createdAt: new Date(user.created_at), tags: [local] },
      cutoff,
    );
    return { kind: "auth_user", id: user.id, label: email || user.id, decision };
  });
}

export function planFlyMachineCleanup(
  machines: FlyMachineFixture[],
  cutoff: Date,
  e2eUserIds: Set<string>,
): CleanupPlanItem[] {
  return machines.map((machine) => ({
    kind: "fly_machine",
    id: machine.id,
    label: `${machine.name} (${machine.id})`,
    decision: decideFlyMachine(machine, cutoff, e2eUserIds),
  }));
}
