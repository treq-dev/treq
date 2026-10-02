/**
 * Shared repo seed for README / web-home marketing screenshots.
 * The committed hero is assets/screenshots/code.png.
 * Landing crops generate into web/static/img/landing/.
 *
 * Builds a lorem-ipsum event-bus repo: stacked workspaces with GitHub PRs,
 * mixed CI, nested directories, and a real conflict under packages/web.
 */
import path from "node:path";
import {
  checkAndRebaseWorkspaces,
  createCommit,
  createWorkspace,
  ensureWorkspaceIndexed,
  getWorkspaces,
  setWorkspaceTargetBranch,
} from "../../src/lib/api";
import { getFullWorkspacePath } from "../../src/lib/utils";
import {
  commitWorkspaceFile,
  createTestRepo,
  openRepo,
  resolveWorkspacePath,
  writeRepoFile,
  writeWorkspaceFile,
} from "../../test/utils";

export const STACK_PARENT_BRANCH = "feat/event-ingest";
export const MARKETING_BRANCH = "feat/empty-event-message";
export const SIBLING_BRANCHES = [
  "feat/keyvalues-cache",
  "feat/alerting-logs",
] as const;

const README = `# event-bus

Lorem ipsum dolor sit amet, consectetur adipiscing elit. The ingest
pipeline accepts Discord and Slack webhooks, normalizes them into
\`EventBody\`, and fans them out to alerting and the web feed.

## Packages

- \`packages/api\` — ingest, schema, retries
- \`packages/web\` — event feed and client
`;

const INGEST_SRC = `export type Provider = "discord" | "slack";

export async function ingest(provider: Provider, raw: unknown): Promise<void> {
  const body = JSON.stringify(raw);
  await fetch("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}
`;

const SCHEMA_SRC = `export type EventBody = {
  event_message?: string;
  provider: "discord" | "slack";
  payload: Record<string, unknown>;
};
`;

const CLIENT_SRC = `import type { EventBody } from "../../../api/src/schema";

export async function postEvent(body: EventBody): Promise<Response> {
  const message =
    typeof body.event_message === "string" && body.event_message.length > 0
      ? body.event_message
      : JSON.stringify(body);

  return fetch("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, event_message: message }),
  });
}
`;

const CLIENT_TEST = `import { describe, expect, it, vi } from "vitest";
import { postEvent } from "./client";

describe("postEvent", () => {
  it("json stringifies body when event_message is absent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await postEvent({
      provider: "discord",
      payload: { id: 1 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/events",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"event_message"'),
      }),
    );
  });
});
`;

const HOME_MAIN = `export function HomePage() {
  return (
    <main>
      <h1>Lorem ipsum dolor sit amet</h1>
      <p>Consectetur adipiscing elit. Sed do eiusmod tempor incididunt.</p>
    </main>
  );
}
`;

const HOME_CHILD = `import { EventFeed } from "../components/EventFeed";

export function HomePage() {
  return (
    <main>
      <h1>Lorem ipsum — event feed</h1>
      <EventFeed source="discord" />
    </main>
  );
}
`;

const HOME_PARENT_LATER = `export function HomePage() {
  return (
    <main>
      <h1>Lorem ipsum dolor sit amet</h1>
      <p>Ut labore et dolore magna aliqua. The ingest stack owns this page.</p>
    </main>
  );
}
`;

const EVENT_FEED = `export function EventFeed(props: { source: "discord" | "slack" }) {
  return <section aria-label="event feed">{props.source}</section>;
}
`;

const CACHE_SRC = `const store = new Map<string, string>();

export function setKey(key: string, value: string): void {
  store.set(key, value);
}

export function getKey(key: string): string | undefined {
  return store.get(key);
}
`;

const ALERTING_SRC = `export function formatAlert(line: string): string {
  return \`[lorem] \${line}\`;
}
`;

export type MarketingFixture = {
  repoPath: string;
  workspace: { id: number; path: string; branch_name: string };
};

async function workspaceByBranch(repoPath: string, branch: string) {
  const workspace = (await getWorkspaces(repoPath)).find(
    (candidate) => candidate.branch_name === branch,
  );
  if (!workspace) {
    throw new Error(`Expected ${branch} workspace to exist`);
  }
  return workspace;
}

/**
 * Seed a stacked, GitHub-shaped lorem ipsum repo. Callers mock GitHub/CI,
 * render Dashboard, and navigate.
 */
export async function seedReadmeMarketingRepo(): Promise<MarketingFixture> {
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  await writeRepoFile(repoPath, "README.md", README, false);
  await createCommit(repoPath, null, "docs: describe event-bus");
  await writeRepoFile(
    repoPath,
    "packages/web/src/pages/Home.tsx",
    HOME_MAIN,
    false,
  );
  await createCommit(repoPath, null, "feat: add lorem home page");
  await writeRepoFile(
    repoPath,
    "packages/web/src/components/EventFeed.tsx",
    EVENT_FEED,
    false,
  );
  await createCommit(repoPath, null, "feat: add event feed stub");

  for (const branch of SIBLING_BRANCHES) {
    await createWorkspace(repoPath, branch);
  }

  await createWorkspace(repoPath, STACK_PARENT_BRANCH);
  const parent = await workspaceByBranch(repoPath, STACK_PARENT_BRANCH);
  await commitWorkspaceFile(
    repoPath,
    { id: parent.id, path: parent.workspace_path },
    "packages/api/src/ingest.ts",
    INGEST_SRC,
    "feat: ingest Discord and Slack events",
  );
  await commitWorkspaceFile(
    repoPath,
    { id: parent.id, path: parent.workspace_path },
    "packages/api/src/schema.ts",
    SCHEMA_SRC,
    "feat: add EventBody schema",
  );

  await createWorkspace(repoPath, MARKETING_BRANCH);
  const workspace = await workspaceByBranch(repoPath, MARKETING_BRANCH);
  await setWorkspaceTargetBranch(
    repoPath,
    getFullWorkspacePath(workspace),
    workspace.id,
    STACK_PARENT_BRANCH,
  );

  const workspacePath = resolveWorkspacePath(
    repoPath,
    workspace.workspace_path,
  );
  writeWorkspaceFile(workspacePath, "README.md", README);
  writeWorkspaceFile(workspacePath, "packages/web/src/lib/client.ts", CLIENT_SRC);
  await createCommit(
    repoPath,
    workspace.id,
    "feat: handle empty event messages",
  );
  writeWorkspaceFile(
    workspacePath,
    "packages/web/src/lib/client.test.ts",
    CLIENT_TEST,
  );
  writeWorkspaceFile(
    workspacePath,
    "packages/web/src/pages/Home.tsx",
    HOME_CHILD,
  );
  await createCommit(
    repoPath,
    workspace.id,
    "feat: wire event feed on the home page",
  );

  const cache = await workspaceByBranch(repoPath, SIBLING_BRANCHES[0]);
  await commitWorkspaceFile(
    repoPath,
    { id: cache.id, path: cache.workspace_path },
    "packages/api/src/cache.ts",
    CACHE_SRC,
    "feat: keyvalues cache",
  );

  const alerting = await workspaceByBranch(repoPath, SIBLING_BRANCHES[1]);
  await commitWorkspaceFile(
    repoPath,
    { id: alerting.id, path: alerting.workspace_path },
    "packages/api/src/alerting.ts",
    ALERTING_SRC,
    "feat: alerting logs",
  );

  // Diverge the parent after the child forked so rebase produces a real
  // conflict under packages/web/src/pages. Both sides rewrite the same lines
  // of Home.tsx, so the file is overwritten here, not appended to.
  writeWorkspaceFile(
    resolveWorkspacePath(repoPath, parent.workspace_path),
    "packages/web/src/pages/Home.tsx",
    HOME_PARENT_LATER,
    false,
  );
  await createCommit(
    repoPath,
    parent.id,
    "fix: clarify home copy for ingest owners",
  );
  await checkAndRebaseWorkspaces(
    repoPath,
    workspace.id,
    STACK_PARENT_BRANCH,
    true,
  );
  await ensureWorkspaceIndexed(repoPath, workspace.id, workspacePath);

  return {
    repoPath,
    workspace: {
      id: workspace.id,
      path: workspace.workspace_path,
      branch_name: workspace.branch_name,
    },
  };
}

export const README_SCREENSHOTS_DIR = path.join("assets", "screenshots");
export const LANDING_SCREENSHOTS_DIR = path.join(
  "web",
  "static",
  "img",
  "landing",
);
