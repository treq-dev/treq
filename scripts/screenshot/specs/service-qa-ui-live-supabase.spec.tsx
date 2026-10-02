/**
 * Live UI + GitHub webhook simulation against local Supabase.
 *
 * Does NOT seed merge_queue_entries. Workspaces enter via simulated
 * pull_request labeled webhooks; CI via check_suite; merges via the worker
 * (MERGE_QUEUE_GITHUB_STUB). Screenshots show the GitHub Merge Queue tab
 * updating through the real get_repo_branch_queue_statuses RPC.
 */
import * as React from "react";
import { invalidateQueries } from "../../../src/lib/swr-cache";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SettingsPage } from "../../../src/components/SettingsPage";
import { GitHubPanel } from "../../../src/components/GitHubPanel";
import { supabase } from "../../../src/lib/supabase";
import { render, screen, waitFor, within } from "../../../test/test-utils";
import { createTestRepo, openRepo } from "../../../test/utils";
import { captureDocument } from "../capture";
import { getServiceClient } from "../../service-qa/clients";
import { FEATURES as SERVICE_QA_FEATURES } from "../../service-qa/features";
import {
  createTestUser,
  deleteTestUser,
  linkGithubRepo,
  signInWithEmailPassword,
} from "../../service-qa/seed";
import {
  drainMergeQueueWorker,
  drainQueueViaCiAndMerge,
  simulateEnqueueWorkspace,
  type WorkspacePr,
} from "../../service-qa/webhook";
import { TWO_PLUS_INDEPENDENT_PLUS_THREE_WITH_SIBLING } from "../../service-qa/topologies";

const { mockGetGitRemoteUrl, auth } = vi.hoisted(() => ({
  mockGetGitRemoteUrl: vi.fn(),
  auth: {
    user: null as { id: string; email?: string } | null,
    session: null as { access_token: string; refresh_token: string } | null,
    loading: false,
    subscription: {
      plan: "pro" as const,
      status: "active" as const,
      current_period_end: null as string | null,
    },
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshSubscription: vi.fn(),
    exchangeToken: vi.fn(),
  },
}));

vi.mock("../../../src/lib/features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/lib/features")>();
  return {
    ...actual,
    FEATURES: {
      ...actual.FEATURES,
      pro: true,
      stripePayments: false,
      emailSignup: true,
      mergeQueue: true,
    },
  };
});

vi.mock("../../../src/stores/authStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/stores/authStore")>();
  const { createAuthStoreMock } = await import(
    "../../../test/mocks/zustandAuthStore"
  );
  return { ...actual, useAuthStore: createAuthStoreMock(auth) };
});

vi.mock("../../../src/lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/api")>(
    "../../../src/lib/api",
  );
  return {
    ...actual,
    getGitRemoteUrl: mockGetGitRemoteUrl,
    ghListIssues: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    ghListPrs: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
});

expect(SERVICE_QA_FEATURES.emailSignup).toBe(true);

const WORKSPACES: WorkspacePr[] = [
  {
    number: 201,
    branch: "feat/workspace-one",
    headSha: "1111111111111111111111111111111111111111",
    title: "Workspace one",
  },
  {
    number: 202,
    branch: "feat/workspace-two",
    headSha: "2222222222222222222222222222222222222222",
    title: "Workspace two",
  },
  {
    number: 203,
    branch: "feat/workspace-three",
    headSha: "3333333333333333333333333333333333333333",
    title: "Workspace three",
  },
];

async function seedLiveSupabaseUser(fullName: string) {
  const admin = getServiceClient();
  const testUser = await createTestUser();
  const linked = await linkGithubRepo(admin, testUser.user.id, { fullName });
  const { client, user } = await signInWithEmailPassword(
    testUser.email,
    testUser.password,
  );
  const {
    data: { session },
    error,
  } = await client.auth.getSession();
  if (error || !session) {
    throw new Error(`getSession failed: ${error?.message ?? "no session"}`);
  }

  const { error: setErr } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (setErr) throw setErr;

  auth.user = { id: user.id, email: testUser.email };
  auth.session = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  };
  auth.subscription = {
    plan: "pro",
    status: "active",
    current_period_end: null,
  };

  return { admin, testUser, linked, session };
}

/** Force React Query to re-hit live RPCs after webhook/worker advances. */
function RefetchBridge({
  repoFullName,
  onReady,
}: {
  repoFullName: string;
  onReady: (refetch: () => Promise<void>) => void;
}) {
  React.useEffect(() => {
    onReady(async () => {
      await invalidateQueries([
        "repo-branch-queue-statuses-panel",
        repoFullName,
      ]);
      await invalidateQueries(["merge-queue-enabled", repoFullName]);
    });
  }, [repoFullName, onReady]);
  return null;
}

it("captures Enable merge queue against live local Supabase RPCs", async () => {
  const fullName = `service-qa/ui-${Date.now()}`;
  const { admin, testUser, linked } = await seedLiveSupabaseUser(fullName);
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  const [owner, repo] = fullName.split("/");
  mockGetGitRemoteUrl.mockResolvedValue({ owner, repo, full_name: fullName });

  try {
    const { data: before, error: beforeErr } = await supabase.rpc(
      "get_merge_queue_enabled",
      { p_repo_full_name: fullName },
    );
    expect(beforeErr).toBeNull();
    expect(before).toBe(false);

    const user = userEvent.setup();
    render(<SettingsPage repoPath={repoPath} onClose={vi.fn()} />);
    await user.click(await screen.findByRole("tab", { name: /integrations/i }));

    const section = await screen.findByTestId("merge-queue-setting");
    const cta = await within(section).findByRole("button", {
      name: /enable merge queue/i,
    });
    await captureDocument(document, {
      name: "service-qa-ui-01-merge-queue-off",
      expectations: [
        'Settings › Integrations shows an "Enable merge queue" CTA for the linked repo.',
        "The merge queue row describes automatic merges once CI passes.",
        "No ON toggle is shown yet — the queue is still off.",
      ],
    });

    await user.click(cta);

    const toggle = await within(section).findByRole("switch", {
      name: /enable merge queue/i,
    });
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });

    const { data: after, error: afterErr } = await supabase.rpc(
      "get_merge_queue_enabled",
      { p_repo_full_name: fullName },
    );
    expect(afterErr).toBeNull();
    expect(after).toBe(true);
    expect(linked.fullName).toBe(fullName);

    await captureDocument(document, {
      name: "service-qa-ui-02-merge-queue-on",
      expectations: [
        "After clicking Enable, the control is an ON toggle (aria-checked true).",
        'Copy updates to "Queued branches merge automatically once CI passes."',
        "No error text is visible — the live set_merge_queue_enabled RPC succeeded.",
      ],
    });
  } finally {
    await supabase.auth.signOut();
    await admin
      .from("github_app_installations")
      .delete()
      .eq("id", linked.installationId);
    await deleteTestUser(admin, testUser.user.id);
  }
}, 120_000);

it("simulates multi-workspace enqueue, CI, and merge until the queue drains", async () => {
  const fullName = `service-qa/ui-drain-${Date.now()}`;
  const { admin, testUser, linked } = await seedLiveSupabaseUser(fullName);
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  const [owner, repo] = fullName.split("/");
  mockGetGitRemoteUrl.mockResolvedValue({ owner, repo, full_name: fullName });

  let refetchQueue: (() => Promise<void>) | null = null;

  try {
    const { error: enableErr } = await supabase.rpc("set_merge_queue_enabled", {
      p_repo_full_name: fullName,
      p_enabled: true,
    });
    expect(enableErr).toBeNull();

    // Serial lanes so the tab shows a multi-entry queue before CI finishes.
    const { error: cfgErr } = await admin
      .from("merge_queue_configs")
      .update({ batch_size: 1, max_parallel_queues: 1 })
      .eq("repo_id", linked.repoId);
    expect(cfgErr).toBeNull();

    const user = userEvent.setup();
    render(
      <div className="h-[800px] w-[480px] border border-border bg-background">
        <RefetchBridge
          repoFullName={fullName}
          onReady={(fn) => {
            refetchQueue = fn;
          }}
        />
        <GitHubPanel repoPath={repoPath} onOpenSettings={vi.fn()} />
      </div>,
    );

    await user.click(await screen.findByRole("tab", { name: /merge queue/i }));
    await screen.findByText(/merge queue is empty|merge queue is off/i);

    // Simulate Add-to-Queue for three workspaces (GitHub labeled webhooks).
    for (const pr of WORKSPACES) {
      await simulateEnqueueWorkspace({
        installationId: linked.installationId,
        repoId: linked.repoId,
        fullName,
        pr: { ...pr, baseBranch: linked.defaultBranch },
      });
    }
    await drainMergeQueueWorker();
    await refetchQueue?.();

    await screen.findByText("PR #201");
    await screen.findByText("PR #202");
    await screen.findByText("PR #203");
    await screen.findByText(/feat\/workspace-one/);

    await captureDocument(document, {
      name: "service-qa-ui-03-queue-filled",
      viewport: { width: 520, height: 900 },
      expectations: [
        "Merge Queue tab lists three workspaces added via simulated labeled webhooks (PR #201–#203).",
        "feat/workspace-one, feat/workspace-two, and feat/workspace-three are visible.",
        "At least one entry shows Queued or Running checks — entries were not DB-seeded.",
      ],
    });

    // CI completion + stubbed merge until nothing left active.
    await drainQueueViaCiAndMerge({
      installationId: linked.installationId,
      repoId: linked.repoId,
      fullName,
    });
    await refetchQueue?.();

    await waitFor(async () => {
      const { data, error } = await supabase.rpc(
        "get_repo_branch_queue_statuses",
        { p_repo_full_name: fullName },
      );
      expect(error).toBeNull();
      const rows = (data ?? []) as { status: string }[];
      const active = rows.filter((r) =>
        ["queued", "testing", "merging"].includes(r.status),
      );
      expect(active).toHaveLength(0);
    });

    // Fully merged work drops out of the default view.
    await waitFor(() => {
      expect(screen.getByText("Merge queue is empty.")).toBeVisible();
    });
    await screen.findByRole("checkbox", { name: /^merged$/i });
    await captureDocument(document, {
      name: "service-qa-ui-04-queue-drained",
      viewport: { width: 520, height: 900 },
      expectations: [
        "After the queue drains, the default view is empty above main.",
        'A "Merged" checkmark control is available to reveal completed PRs below main.',
        "The Merge Queue tab is still selected.",
      ],
    });

    await user.click(screen.getByRole("checkbox", { name: /^merged$/i }));
    await screen.findByTestId("merge-queue-history");
    expect(screen.getAllByText("Merged").length).toBeGreaterThanOrEqual(3);
    await captureDocument(document, {
      name: "service-qa-ui-04b-queue-history",
      viewport: { width: 520, height: 900 },
      expectations: [
        "With Merged checked, PR #201–#203 appear below the main terminator as Merged.",
      ],
    });
  } finally {
    await supabase.auth.signOut();
    await admin
      .from("github_app_installations")
      .delete()
      .eq("id", linked.installationId);
    await deleteTestUser(admin, testUser.user.id);
  }
}, 180_000);

it("captures a 2-stack + independent + 3-stack with siblings through drain", async () => {
  const fullName = `service-qa/ui-stacks-${Date.now()}`;
  const { admin, testUser, linked } = await seedLiveSupabaseUser(fullName);
  const { repoPath } = createTestRepo(false);
  openRepo(repoPath);

  const [owner, repo] = fullName.split("/");
  mockGetGitRemoteUrl.mockResolvedValue({ owner, repo, full_name: fullName });

  let refetchQueue: (() => Promise<void>) | null = null;

  try {
    const { error: enableErr } = await supabase.rpc("set_merge_queue_enabled", {
      p_repo_full_name: fullName,
      p_enabled: true,
    });
    expect(enableErr).toBeNull();

    await admin
      .from("merge_queue_configs")
      .update({ batch_size: 1, max_parallel_queues: 1 })
      .eq("repo_id", linked.repoId);

    const user = userEvent.setup();
    render(
      <div className="h-[900px] w-[520px] border border-border bg-background">
        <RefetchBridge
          repoFullName={fullName}
          onReady={(fn) => {
            refetchQueue = fn;
          }}
        />
        <GitHubPanel repoPath={repoPath} onOpenSettings={vi.fn()} />
      </div>,
    );

    await user.click(await screen.findByRole("tab", { name: /merge queue/i }));
    await screen.findByText(/merge queue is empty|merge queue is off/i);

    for (const pr of TWO_PLUS_INDEPENDENT_PLUS_THREE_WITH_SIBLING) {
      await simulateEnqueueWorkspace({
        installationId: linked.installationId,
        repoId: linked.repoId,
        fullName,
        pr,
      });
    }
    await drainMergeQueueWorker();
    await refetchQueue?.();

    expect(
      await screen.findByTestId("merge-queue-stack-feat/two-base"),
    ).toBeTruthy();
    expect(
      await screen.findByTestId("merge-queue-stack-feat/three-base"),
    ).toBeTruthy();
    expect(
      await screen.findByTestId("merge-queue-single-fix/solo"),
    ).toBeTruthy();
    expect(
      await screen.findByTestId("merge-queue-single-feat/three-sib"),
    ).toBeTruthy();

    expect(screen.getByText("Stack of 2")).toBeVisible();
    expect(screen.getByText("Stack of 3")).toBeVisible();
    expect(screen.getByText("PR #301")).toBeVisible();
    expect(screen.getByText("PR #303")).toBeVisible();
    expect(screen.getByText("PR #306")).toBeVisible();
    expect(screen.getByText("PR #307")).toBeVisible();

    await captureDocument(document, {
      name: "service-qa-ui-05-stacks-filled",
      viewport: { width: 560, height: 1000 },
      expectations: [
        'Merge Queue shows bordered stack cards: a "Stack of 2" (feat/two-base → feat/two-top) and a "Stack of 3" (three-base → mid → top).',
        "fix/solo appears as its own card between the stacks.",
        "feat/three-sib is listed as the sibling of three-mid (same parent base).",
      ],
    });

    await drainQueueViaCiAndMerge({
      installationId: linked.installationId,
      repoId: linked.repoId,
      fullName,
      maxCycles: 40,
    });
    await refetchQueue?.();

    await waitFor(async () => {
      const { data, error } = await supabase.rpc(
        "get_repo_branch_queue_statuses",
        { p_repo_full_name: fullName },
      );
      expect(error).toBeNull();
      const active = ((data ?? []) as { status: string }[]).filter((r) =>
        ["queued", "testing", "merging"].includes(r.status),
      );
      expect(active).toHaveLength(0);
    });

    await waitFor(() => {
      expect(screen.getByText("Merge queue is empty.")).toBeVisible();
    });
    await user.click(
      await screen.findByRole("checkbox", { name: /^merged$/i }),
    );
    await screen.findByTestId("merge-queue-history");
    await waitFor(() => {
      expect(screen.getAllByText("Merged").length).toBeGreaterThanOrEqual(7);
    });
    await captureDocument(document, {
      name: "service-qa-ui-06-stacks-drained",
      viewport: { width: 560, height: 1000 },
      expectations: [
        "With Merged checked after drain, all seven PRs (#301–#307) appear as Merged below main.",
        "The active queue above main is empty.",
      ],
    });
  } finally {
    await supabase.auth.signOut();
    await admin
      .from("github_app_installations")
      .delete()
      .eq("id", linked.installationId);
    await deleteTestUser(admin, testUser.user.id);
  }
}, 240_000);
