import os from "node:os";

/**
 * Vitest runs unit and integration as separate projects with different
 * `maxWorkers`. Since Vitest 4, every project that shares
 * `sequence.groupOrder` must also share the same resolved `maxWorkers`, or
 * collection fails before any tests run:
 *
 *   Projects "unit" and "integration-parallel" have different 'maxWorkers'
 *   but same 'sequence.groupOrder'. Provide unique 'sequence.groupOrder'.
 *
 * Lower `groupOrder` runs first. Keep these constants in sync with
 * vitest.unit.config.ts, vitest.integration-serial.config.ts, and
 * vitest.integration-parallel.config.ts.
 */
export const VITEST_PROJECT_SEQUENCE = {
  unit: 0,
  integrationSerial: 1,
  integrationParallel: 2,
} as const;

export function resolveDefaultMaxWorkers(cpuCount?: number): number {
  const numCpus =
    cpuCount ??
    (typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length);
  return Math.max(numCpus - 1, 1);
}

/** Effective worker limits for each Vitest project in the root workspace. */
export const VITEST_PROJECT_WORKERS = {
  unit: resolveDefaultMaxWorkers(),
  integrationSerial: 1,
  // 3 workers cut the parallel phase by about a minute on a 4-core runner,
  // but starved spawn_blocking: browser/review and code/filebrowser timed
  // out. Keep 2.
  integrationParallel: 2,
} as const;

export type VitestProjectSequenceDefinition = {
  name: string;
  groupOrder: number;
  maxWorkers: number;
};

/** Canonical project layout used by config regression tests. */
export const VITEST_PROJECT_DEFINITIONS: VitestProjectSequenceDefinition[] = [
  {
    name: "unit",
    groupOrder: VITEST_PROJECT_SEQUENCE.unit,
    maxWorkers: VITEST_PROJECT_WORKERS.unit,
  },
  {
    name: "integration-serial",
    groupOrder: VITEST_PROJECT_SEQUENCE.integrationSerial,
    maxWorkers: VITEST_PROJECT_WORKERS.integrationSerial,
  },
  {
    name: "integration-parallel",
    groupOrder: VITEST_PROJECT_SEQUENCE.integrationParallel,
    maxWorkers: VITEST_PROJECT_WORKERS.integrationParallel,
  },
];

/**
 * Mirrors Vitest's `groupSpecs` guard: two projects with different
 * `maxWorkers` cannot share a `sequence.groupOrder`.
 */
export function assertUniqueGroupOrderPerMaxWorkers(
  projects: VitestProjectSequenceDefinition[],
): void {
  const byOrder = new Map<number, VitestProjectSequenceDefinition>();
  for (const project of projects) {
    const existing = byOrder.get(project.groupOrder);
    if (existing && existing.maxWorkers !== project.maxWorkers) {
      throw new Error(
        `Projects "${existing.name}" and "${project.name}" have different 'maxWorkers' (${existing.maxWorkers} vs ${project.maxWorkers}) but same 'sequence.groupOrder' (${project.groupOrder}). Provide unique 'sequence.groupOrder' for them.`,
      );
    }
    byOrder.set(project.groupOrder, project);
  }
}
