import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VITEST_PROJECT_SEQUENCE } from "./vitest.projects";

/**
 * Fast unit tests: mocked Tauri invoke, no NAPI/jj required.
 * Safe to run with fileParallelism enabled.
 */
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
      },
    }),
  ],
  test: {
    name: "unit",
    sequence: {
      groupOrder: VITEST_PROJECT_SEQUENCE.unit,
    },
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "test/merge-queue/**/*.test.ts",
      "test/linear-proxy/**/*.test.ts",
      "test/billing/**/*.test.ts",
      "test/vitest-config.test.ts",
      "test/remote-ssh-traceability.test.ts",
    ],
    globals: true,
    fileParallelism: true,
    testTimeout: 15000,
    env: {
      DEBUG_PRINT_LIMIT: "10",
    },
  },
});
