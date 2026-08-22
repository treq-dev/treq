import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

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
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "test/merge-queue/**/*.test.ts",
    ],
    globals: true,
    fileParallelism: true,
    testTimeout: 15000,
  },
});
