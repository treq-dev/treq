import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { setActiveRepositorySingleton } from "./active-repository";
import type { SshEndpoint } from "./api-types-remote";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./remote-dispatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./remote-dispatch")>()),
  dispatch: vi.fn(() => Promise.resolve(null)),
  dispatchMutationOverSsh: vi.fn(() => Promise.resolve({ status: "applied" })),
}));
vi.mock("./swr-cache", () => ({
  invalidateQueries: vi.fn(() => Promise.resolve()),
  setQueryData: vi.fn(() => Promise.resolve()),
}));

const ROOT = "/srv/guarded";
const PATH_FIRST = /^(?:async\s*)?\(\s*(repoPath|workspacePath|path|paths)\b/;
// Takes temporary agent CLI files, not repository paths.
const NOT_REPOSITORY_PATHS = new Set(["cleanupAgentCliFiles"]);

// Local commands that still receive a remote path. Each entry is a gap to
// close: guard it, route it, or scope it, then remove it from this list.
const KNOWN_UNGUARDED: string[] = [
  "get_log_timeseries",
  "get_repo_logs",
  "get_workspace_setup_status",
  "github_open_or_create_workspace_from_issue",
  "init_repo",
  "is_repo_trusted",
  "list_gitignored_path_suggestions",
  "list_installed_skills",
  "list_send_artifacts",
  "list_skill_catalog",
  "list_workflow_runs",
  "list_workflows",
  "load_repo_yaml_config",
  "rerun_workspace_setup_script",
  "run_logs_sql",
  "run_workflow",
  "run_workflow_job",
  "set_git_submodule_synced",
  "set_window_repo_path",
  "trust_repo",
  "write_send_review_image",
];

function mentionsRemotePath(value: unknown): boolean {
  if (typeof value === "string") {
    return value === ROOT || value.startsWith(`${ROOT}/`);
  }
  if (Array.isArray(value)) return value.some(mentionsRemotePath);
  if (value && typeof value === "object") {
    return Object.values(value).some(mentionsRemotePath);
  }
  return false;
}

describe("path-taking api wrappers for a remote repository", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(null);
    const endpoint = { id: "ep" } as unknown as SshEndpoint;
    setActiveRepositorySingleton({
      id: "remote",
      location: { type: "ssh", host: "box", path: ROOT },
      endpoint,
      endpointId: "ep",
      endpointGeneration: 0,
      canonicalPath: ROOT,
      displayName: "guarded",
      transport: { type: "ssh", endpoint },
    });
  });

  it("never hand a remote path to a local command", async () => {
    const wrappers = Object.entries(api).filter(
      ([name, value]) =>
        typeof value === "function" &&
        !NOT_REPOSITORY_PATHS.has(name) &&
        PATH_FIRST.test(value.toString()),
    ) as [string, (...args: unknown[]) => unknown][];
    expect(wrappers.length).toBeGreaterThan(50);

    await Promise.allSettled(
      wrappers.map(async ([, wrapper]) => {
        const first = PATH_FIRST.exec(wrapper.toString())?.[1];
        return wrapper(first === "paths" ? [ROOT] : ROOT, 1, "x", "y", "z");
      }),
    );

    const leaked = vi
      .mocked(invoke)
      .mock.calls.filter(([, args]) => mentionsRemotePath(args))
      .map(([command]) => command);
    expect([...new Set(leaked)].sort()).toEqual(KNOWN_UNGUARDED);
  });
});
