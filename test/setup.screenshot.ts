/**
 * Screenshot harness setup (scripts/screenshot/specs/**).
 *
 * Same real tauri-test invoke as test/setup.integration.ts, with one
 * difference: it does not fail a run when a still-un-migrated jj_* command
 * gets invoked. test/integration/** enforces zero jj_* calls as an ongoing
 * migration-debt tracker; the screenshot harness exists to show current real
 * behavior (including that debt) rather than gate on it, so it only logs
 * which jj_* commands fired instead of failing the spec.
 *
 * Prerequisites:
 *   1. Run `npm run build:napi` to compile the src-tauri cdylib.
 *   2. Have `jj` and `git` installed and on PATH.
 */

import os from "os";
import path from "path";
import fs from "fs";
import { createRequire } from "node:module";
import { afterEach, vi } from "vitest";

import "./setup.common";

process.env.TREQ_DISABLE_AUTO_REBASE = "1";
process.env.TREQ_DISABLE_AUTO_UPDATE = "1";

const testDbPath = path.join(os.tmpdir(), `treq-screenshot-${Date.now()}.db`);
process.env.TREQ_APP_DB_PATH = testDbPath;
process.env.TREQ_APP_DATA_DIR = path.dirname(testDbPath);

const require = createRequire(import.meta.url);
const tauriTest = require("../src-tauri/target") as {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

const jjCalls: string[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    if (cmd.startsWith("jj_")) {
      jjCalls.push(cmd);
    }
    return tauriTest.invoke(cmd, args ?? {});
  }),
  convertFileSrc: (filePath: string) => `file://${filePath}`,
  isTauri: () => false,
}));

afterEach(() => {
  if (jjCalls.length > 0) {
    console.log(
      `[app-qa] un-migrated jj_* commands exercised in this spec: ${jjCalls.join(", ")}`,
    );
  }
  jjCalls.length = 0;
});

process.on("exit", () => {
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch {
    // ignore
  }
});
