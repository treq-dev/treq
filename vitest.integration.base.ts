import type { ViteUserConfig } from "vitest/config";
import { globSync } from "node:fs";
import react from "@vitejs/plugin-react";

/**
 * Shared config for the NAPI-backed integration projects: real Rust
 * dispatch, real jj repos. Each project (serial/parallel, see
 * vitest.integration.config.ts) layers its own `include`/`pool` settings
 * on top of this.
 */
export const integrationBaseTest: ViteUserConfig["test"] = {
  environment: "jsdom",
  setupFiles: ["./test/setup.integration.ts"],
  globals: true,
  // Per-repo `local.db` lives under each `createTestRepo` temp dir. The
  // app-level DB (`TREQ_APP_DB_PATH` / napi `OnceLock`) is process-global,
  // so every project still needs one process per file ("forks", not
  // "threads") -- otherwise files sharing a worker process would share an
  // app.db.
  pool: "forks",
  testTimeout: 5_000,
  hookTimeout: 5_000,
};

export const integrationPlugins = [
  react({
    babel: {
      plugins: [["babel-plugin-react-compiler", { target: "19" }]],
    },
  }),
];

/**
 * Files in review/ and workspace/ that never poll the jj "Changes" list:
 * dialogs, stack ordering, scheduling, the code tab, the terminal pane, and
 * Dashboard-free API tests. They run in the parallel project. Any other
 * file in those directories, including a new one, runs serially.
 */
const parallelSafeInSerialDirs = new Set([
  "test/integration/workspace/code.test.tsx",
  "test/integration/workspace/create-dialog-branch-name.test.tsx",
  "test/integration/workspace/default-branch-sync.test.ts",
  "test/integration/workspace/rename-dialog.test.tsx",
  "test/integration/workspace/reorder-stack.test.tsx",
  "test/integration/workspace/schedule.test.tsx",
  "test/integration/workspace/sparse.test.ts",
  "test/integration/workspace/stack-dialog-stack-card.test.tsx",
  "test/integration/workspace/symlink-dirs.test.ts",
  "test/integration/workspace/terminal-pane.test.tsx",
]);

/**
 * Integration files that contend for spawn_blocking / jj-lib and must run
 * one at a time. The serial project includes exactly these; the parallel
 * project excludes them.
 */
export const serialIntegrationFiles = globSync(
  "test/integration/{review,workspace}/**/*.test.{ts,tsx}",
)
  .map((file) => file.split("\\").join("/"))
  .filter((file) => !parallelSafeInSerialDirs.has(file))
  .sort();
