import { defineConfig } from "vitest/config";
import {
  integrationBaseTest,
  integrationPlugins,
} from "./vitest.integration.base";
import { serialIntegrationFiles } from "./vitest.integration.serial";
import { VITEST_PROJECT_SEQUENCE } from "./vitest.projects";

/**
 * Integration tests that mutate/poll the jj "Changes" file list (staging,
 * discard, review, commit refresh, ...). These contend heavily for
 * spawn_blocking / jj-lib: running them concurrently with other NAPI forks
 * starves that pool and the Changes list never resolves in time, so they
 * stay serial. A file joins this project by calling `runSerially()` at its
 * top level (see vitest.integration.serial.ts). See
 * vitest.integration-parallel.config.ts for the rest.
 */
export default defineConfig({
  plugins: integrationPlugins,
  test: {
    ...integrationBaseTest,
    name: "integration-serial",
    sequence: {
      groupOrder: VITEST_PROJECT_SEQUENCE.integrationSerial,
    },
    include: serialIntegrationFiles,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
