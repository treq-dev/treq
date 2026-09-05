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
