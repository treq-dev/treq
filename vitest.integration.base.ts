import type { ViteUserConfig } from "vitest/config";
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
  // Every forked worker transforms and imports the app's module graph
  // again. The on-disk module cache lets later runs skip the transform and
  // part of the import cost; CI restores it between runs (see ci.yml).
  experimental: { fsModuleCache: true },
  // GitHub's ubuntu-22.04 runners are not all equally fast: the same commit
  // has run this suite in 298s on one runner and 501s on another, and `npm
  // ci` (before any test code runs) takes 7-9s on the fast ones and 11-18s
  // on the slow ones. Tests that take ~3s on a fast runner take 5-6.5s on a
  // slow one, so a 5s budget failed whichever tests happened to land on the
  // edge. 10s covers the slowest default-timeout test seen on a slow runner
  // (~6.5s) with headroom. Multi-step UI flows still set their own, larger
  // timeouts.
  testTimeout: 10_000,
  hookTimeout: 10_000,
};

export const integrationPlugins = [
  react({
    babel: {
      plugins: [["babel-plugin-react-compiler", { target: "19" }]],
    },
  }),
];
