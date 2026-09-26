/**
 * Verifies the Treq workflow checks panel (ChecksTab) in its current home:
 * the "Treq checks" section of a GitHub PR's detail pane, shown when a
 * workspace exists for the PR head. Covers the trust gate and per-step
 * pass/fail results after Run All.
 */

import userEvent from "@testing-library/user-event";
import { it, vi } from "vitest";
import { GitHubPanel } from "../../../src/components/GitHubPanel";
import { createWorkspace } from "../../../src/lib/api";
import type { GhPullRequest } from "../../../src/lib/api-types";
import { render, screen, waitFor } from "../../../test/test-utils";
import { createTestRepo, writeRepoFile } from "../../../test/utils";
import { captureDocument } from "../capture";

const api = vi.hoisted(() => ({ ghListPrs: vi.fn(), ghViewPr: vi.fn() }));

// No gh in the sandbox: stub only the GitHub calls. Workspaces, workflow
// discovery, trust and workflow runs all go through the real Rust backend.
vi.mock("../../../src/lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
    "../../../src/lib/api",
  );
  return {
    ...actual,
    getGitRemoteUrl: vi.fn().mockResolvedValue({
      owner: "acme",
      repo: "treq",
      full_name: "acme/treq",
    }),
    ghListIssues: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    ghListPrs: api.ghListPrs,
    ghViewPr: api.ghViewPr,
    getPrChecksForPr: vi.fn().mockResolvedValue(null),
  };
});

const PR: GhPullRequest = {
  number: 12,
  title: "Add workflow checks",
  state: "OPEN",
  url: "https://github.com/acme/treq/pull/12",
  body: null,
  author: { login: "octocat", avatar_url: null },
  labels: [],
  head_ref_name: "feat/checks",
  base_ref_name: "main",
  merge_state_status: "CLEAN",
  created_at: "2026-07-20T10:00:00Z",
  updated_at: "2026-07-20T10:00:00Z",
  comments: [],
  is_draft: false,
};

// One workflow with a passing job and a failing job, so a single "Run All"
// shows both the green-checkmark and the red-X / fail-fast rendering.
const MIXED_WORKFLOW = `
name: Pull request checks
on:
  workflow_dispatch: {}
jobs:
  greet:
    name: Greet Job
    steps:
      - name: Say hello
        run: echo hello
      - name: Say world
        run: echo world
  verify:
    name: Verify Job
    steps:
      - name: Failing check
        run: exit 1
      - name: Never runs
        run: echo skipped
`;

it("captures the Treq checks trust gate and step pass/fail results", async () => {
  api.ghListPrs.mockResolvedValue({ items: [PR], hasMore: false });
  api.ghViewPr.mockResolvedValue(PR);
  const { repoPath } = createTestRepo(false);
  // Incidental background state: "Treq checks" only renders when a
  // workspace exists for the PR head.
  await createWorkspace(repoPath, "feat/checks");
  await writeRepoFile(repoPath, ".treq/workflows/ci.yaml", MIXED_WORKFLOW);

  const user = userEvent.setup();
  render(<GitHubPanel repoPath={repoPath} onOpenSettings={vi.fn()} />);
  await user.click(await screen.findByRole("tab", { name: /pull requests/i }));
  await user.click(
    await screen.findByRole("button", { name: /add workflow checks/i }),
  );
  await screen.findByText("Treq checks");

  // Untrusted: the workflow is listed but execution is gated.
  await screen.findByText("Pull request checks");
  await screen.findByText("Greet Job");
  await screen.findByText("Verify Job");
  const trustButton = await screen.findByRole("button", {
    name: /Trust Repository/i,
  });
  await captureDocument(document, {
    name: "checks-tab-01-untrusted",
    expectations: [
      'Inside the PR detail\'s "Treq checks" section, an amber banner reads "Trust this repository to enable running workflow checks." with a "Trust Repository" button.',
      'The workflow card shows "Pull request checks" and lists "Greet Job" and "Verify Job", with "Run All" and the per-job run buttons greyed out.',
      "Every step name has a grey neutral dot icon: no green checkmarks and no red X icons.",
    ],
  });

  // Trusting the repo removes the gate and enables execution.
  await user.click(trustButton);
  await waitFor(() => {
    if (screen.queryByRole("button", { name: /Trust Repository/i })) {
      throw new Error("trust banner still present");
    }
  });
  await captureDocument(document, {
    name: "checks-tab-02-trusted",
    expectations: [
      "The amber trust banner is completely gone from the top of the panel.",
      'The run buttons ("Run All", "Run Greet Job", "Run Verify Job") now appear enabled — normal contrast, not greyed out.',
      "Step names still show grey neutral dot icons, since nothing has been run yet.",
    ],
  });

  // Run every job in the workflow.
  await user.click(await screen.findByRole("button", { name: /Run All/i }));
  await waitFor(
    () => {
      const passIcons = document.querySelectorAll(
        '[data-testid="step-result-pass"]',
      );
      const failIcons = document.querySelectorAll(
        '[data-testid="step-result-fail"]',
      );
      if (passIcons.length !== 2 || failIcons.length !== 1) {
        throw new Error(
          `expected 2 pass / 1 fail, got ${passIcons.length} / ${failIcons.length}`,
        );
      }
    },
    { timeout: 20000 },
  );
  await captureDocument(document, {
    name: "checks-tab-03-after-run-all",
    expectations: [
      'Under "Greet Job", both "Say hello" and "Say world" have green checkmark icons.',
      'Under "Verify Job", "Failing check" has a red X icon.',
      '"Never runs" (the step after the failing one) still shows a grey neutral dot, skipped by fail-fast.',
    ],
  });
}, 90000);
