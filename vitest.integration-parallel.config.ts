import { defineConfig } from "vitest/config";
import { integrationBaseTest, integrationPlugins } from "./vitest.integration.base";
import { VITEST_PROJECT_SEQUENCE } from "./vitest.projects";

/**
 * Integration tests that don't touch the jj "Changes" file list under
 * contention (settings, sidebar, command palette, GitHub panel, browser
 * webviews, file picker, ...). These are safe to fan out across a small
 * worker pool -- see vitest.integration-serial.config.ts for the files
 * that stay serial because of spawn_blocking contention.
 *
 * maxWorkers is kept modest (not "threads"/unbounded) because each worker
 * still loads the full NAPI addon; going wider reproduces the same
 * starvation this split exists to avoid.
 */
export default defineConfig({
  plugins: integrationPlugins,
  test: {
    ...integrationBaseTest,
    name: "integration-parallel",
    sequence: {
      groupOrder: VITEST_PROJECT_SEQUENCE.integrationParallel,
    },
    include: ["test/integration/**/*.test.{ts,tsx}"],
    exclude: [
      "test/integration/review/**/*.test.{ts,tsx}",
      "test/integration/workspace/**/*.test.{ts,tsx}",
    ],
    fileParallelism: true,
    maxWorkers: 2,
  },
});
