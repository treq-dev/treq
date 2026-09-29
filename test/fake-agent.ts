import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const FAKE_AGENT_SCRIPT = path.resolve(__dirname, "fake-agent/fake-agent.sh");

/** CLI names the app launches for each agent; all of them run the fake. */
export const FAKE_AGENT_BINARIES = [
  "claude",
  "codex",
  "cursor-agent",
  "copilot",
] as const;

/**
 * Puts the fake agent on PATH under every agent CLI name and lets the
 * backend spawn real PTYs (`TREQ_TEST_PTY=1`), so a started session runs the
 * fake and its output reaches the terminal through the test event bridge.
 *
 * Returns a function that restores the environment. Call it in `finally`.
 */
export function installFakeAgents(): () => void {
  const dir = mkdtempSync(path.join(tmpdir(), "treq-fake-agents-"));
  for (const binary of FAKE_AGENT_BINARIES) {
    symlinkSync(FAKE_AGENT_SCRIPT, path.join(dir, binary));
  }

  const saved = {
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
    TREQ_TEST_PTY: process.env.TREQ_TEST_PTY,
    TREQ_TEST_BIN_DIR: process.env.TREQ_TEST_BIN_DIR,
  };
  process.env.PATH = `${dir}${path.delimiter}${saved.PATH ?? ""}`;
  // A plain POSIX shell keeps the user's rc files out of the terminal.
  process.env.SHELL = "/bin/sh";
  process.env.TREQ_TEST_PTY = "1";
  // Agent commands prepend the treq bin dir to PATH; under Node that is
  // Node's own bin dir, which may hold a real agent CLI.
  process.env.TREQ_TEST_BIN_DIR = dir;

  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  };
}
