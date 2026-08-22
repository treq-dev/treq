import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Reuses the same jsdom + NAPI harness as vitest.config.ts, via
// test/setup.screenshot.ts (a variant of test/setup.integration.ts that
// doesn't fail a run on still-un-migrated jj_* commands -- see that file's
// header comment), and points at scripts/screenshot specs instead of
// test/integration so screenshot runs stay out of `npm test`.
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.screenshot.ts"],
    include: ["scripts/screenshot/specs/**/*.spec.tsx"],
    globals: true,
    fileParallelism: false,
    testTimeout: 60000,
  },
});
