import { globSync, readFileSync } from "node:fs";

/**
 * A test file opts into the serial project by calling `runSerially()`
 * (test/utils.tsx) at its top level. Use it for files that drive the jj
 * working copy and the Changes/Review views hard: running those next to
 * other NAPI forks starves spawn_blocking and the Changes list times out.
 * Every other integration file runs in the parallel project.
 */
export function isSerialTestSource(source: string): boolean {
  return /^runSerially\(\);?\s*$/m.test(source);
}

/**
 * Integration files that call `runSerially()`. The serial project includes
 * exactly these; the parallel project excludes them.
 */
export const serialIntegrationFiles = globSync(
  "test/integration/**/*.test.{ts,tsx}",
)
  .map((file) => file.split("\\").join("/"))
  .filter((file) => isSerialTestSource(readFileSync(file, "utf8")))
  .sort();
