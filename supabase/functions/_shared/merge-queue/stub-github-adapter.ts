// In-memory GitHub adapter for local service-qa. Activated when
// MERGE_QUEUE_GITHUB_STUB=1 so the worker can build lanes / merge without a
// real GitHub App. PR head SHAs are resolved from merge_queue_entries so
// merge preconditions match the SHAs used when the PR was enqueued.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";
import type { GitHubAdapter, PullRequestSnapshot } from "./github-adapter.ts";

const BASE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function syntheticSha(seed: string): string {
  // 40-char hex-ish id unique enough for test-branch heads.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h.toString(16).padStart(8, "0") + "b".repeat(32)).slice(0, 40);
}

export function isGithubStubEnabled(): boolean {
  const v = Deno.env.get("MERGE_QUEUE_GITHUB_STUB") ?? "";
  return v === "1" || v.toLowerCase() === "true";
}

export class StubGitHubAdapter implements GitHubAdapter {
  private readonly merged = new Set<number>();
  private readonly comments = new Map<number, string[]>();
  private branchTips = new Map<string, string>([["main", BASE_SHA]]);

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly repoId: number,
    private readonly defaultBranch: string,
  ) {
    this.branchTips.set(defaultBranch, BASE_SHA);
  }

  async getBranchSha(branch: string): Promise<string> {
    return this.branchTips.get(branch) ?? BASE_SHA;
  }

  async createOrResetBranch(name: string, sha: string): Promise<void> {
    this.branchTips.set(name, sha);
  }

  async deleteBranch(name: string): Promise<void> {
    this.branchTips.delete(name);
  }

  async mergeInto(
    base: string,
    head: string,
    _message: string,
  ): Promise<string | null> {
    const next = syntheticSha(`${base}:${head}:${Date.now()}`);
    this.branchTips.set(base, next);
    return next;
  }

  async getPR(prNumber: number): Promise<PullRequestSnapshot | null> {
    const { data: entry, error } = await this.supabase
      .from("merge_queue_entries")
      .select("pr_number, pr_sha, pr_title, branch_name, status, queue_id")
      .eq("pr_number", prNumber)
      .order("enqueued_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`stub getPR: ${error.message}`);

    const rows = entry ?? [];
    let match: (typeof rows)[number] | null = null;
    let targetBranch = this.defaultBranch;
    for (const row of rows) {
      const { data: queue } = await this.supabase
        .from("merge_queues")
        .select("repo_id, target_branch")
        .eq("id", row.queue_id)
        .maybeSingle();
      if (queue?.repo_id === this.repoId) {
        match = row;
        targetBranch = queue.target_branch ?? this.defaultBranch;
        break;
      }
    }
    if (!match) return null;

    const merged =
      this.merged.has(prNumber) ||
      match.status === "merged" ||
      match.status === "dequeued";
    return {
      number: prNumber,
      state: merged ? "closed" : "open",
      merged,
      title: match.pr_title ?? `PR #${prNumber}`,
      baseRef: targetBranch,
      headRef: match.branch_name ?? `pr-${prNumber}`,
      headSha: match.pr_sha,
    };
  }

  async mergePR(
    prNumber: number,
    _mergeMethod: string,
    _commitTitle: string,
    expectedHeadSha: string,
  ): Promise<void> {
    const pr = await this.getPR(prNumber);
    if (!pr) {
      throw new Error(`GitHub PUT merge → 404: PR ${prNumber} not found`);
    }
    if (pr.headSha !== expectedHeadSha) {
      throw new Error(
        `GitHub PUT merge → 409: Head SHA was ${pr.headSha}, expected ${expectedHeadSha}`,
      );
    }
    this.merged.add(prNumber);
    const tip = this.branchTips.get(this.defaultBranch) ?? BASE_SHA;
    this.branchTips.set(
      this.defaultBranch,
      syntheticSha(`merge:${prNumber}:${tip}`),
    );
  }

  async createComment(
    prNumber: number,
    body: string,
    marker?: string,
  ): Promise<void> {
    const full = marker ? `${body}\n\n<!-- treq:${marker} -->` : body;
    const list = this.comments.get(prNumber) ?? [];
    list.push(full);
    this.comments.set(prNumber, list);
  }

  async hasCommentWithMarker(prNumber: number, marker: string): Promise<boolean> {
    const needle = `<!-- treq:${marker} -->`;
    return (this.comments.get(prNumber) ?? []).some((c) => c.includes(needle));
  }

  async addLabel(_prNumber: number, _labels: string[]): Promise<void> {}

  async removeLabel(_prNumber: number, _label: string): Promise<void> {}

  async listCheckRuns(
    _ref: string,
  ): Promise<Array<{ name: string; status: string; conclusion: string | null }>> {
    return [];
  }
}
