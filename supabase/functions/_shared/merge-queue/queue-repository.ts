// All merge-queue domain reads and writes (queues, entries, configs, repos).
// No GitHub calls and no scheduling policy live here.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";
import type { EntryStatus } from "./state-machine.ts";

export interface QueueRow {
  id: string;
  repo_id: number;
  target_branch: string;
  paused: boolean;
  bisect_mode: boolean;
}

export interface QueueConfigRow {
  required_checks: string[];
  max_parallel_queues: number;
  batch_size: number;
  merge_method: string;
  queue_trigger_label: string;
  delete_branch_on_merge: boolean;
  enabled: boolean;
}

export interface EntryRow {
  id: string;
  queue_id: string;
  pr_number: number;
  pr_sha: string;
  pr_title: string | null;
  pr_author: string | null;
  branch_name: string | null;
  position: number;
  status: EntryStatus;
}

export interface RepoMeta {
  id: number;
  installationId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
}

export const DEFAULT_CONFIG: QueueConfigRow = {
  required_checks: [],
  max_parallel_queues: 1,
  batch_size: 5,
  merge_method: "squash",
  queue_trigger_label: "merge-queue",
  delete_branch_on_merge: true,
  enabled: true,
};

export async function getQueue(
  supabase: SupabaseClient,
  queueId: string,
): Promise<QueueRow | null> {
  const { data, error } = await supabase
    .from("merge_queues")
    .select("id, repo_id, target_branch, paused, bisect_mode")
    .eq("id", queueId)
    .maybeSingle();
  if (error) throw new Error(`failed to load queue ${queueId}: ${error.message}`);
  return data as QueueRow | null;
}

export async function getOrCreateQueue(
  supabase: SupabaseClient,
  repoId: number,
  targetBranch: string,
): Promise<QueueRow> {
  const { data, error } = await supabase.rpc("get_or_create_merge_queue", {
    p_repo_id: repoId,
    p_target_branch: targetBranch,
  });
  if (error || !data) {
    throw new Error(
      `failed to get/create queue for repo ${repoId} ${targetBranch}: ${error?.message}`,
    );
  }
  return data as QueueRow;
}

export async function getQueueConfig(
  supabase: SupabaseClient,
  repoId: number,
  targetBranch: string,
): Promise<QueueConfigRow> {
  const { data, error } = await supabase
    .from("merge_queue_configs")
    .select(
      "required_checks, max_parallel_queues, batch_size, merge_method, queue_trigger_label, delete_branch_on_merge, enabled",
    )
    .eq("repo_id", repoId)
    .eq("target_branch", targetBranch)
    .maybeSingle();
  if (error) throw new Error(`failed to load config: ${error.message}`);
  return (data as QueueConfigRow | null) ?? DEFAULT_CONFIG;
}

export async function getRepoMeta(
  supabase: SupabaseClient,
  repoId: number,
): Promise<RepoMeta | null> {
  const { data, error } = await supabase
    .from("github_repositories")
    .select("id, installation_id, owner, name, full_name, default_branch")
    .eq("id", repoId)
    .maybeSingle();
  if (error) throw new Error(`failed to load repo ${repoId}: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    installationId: data.installation_id,
    owner: data.owner,
    name: data.name,
    fullName: data.full_name,
    defaultBranch: data.default_branch ?? "main",
  };
}

export async function enqueueEntry(
  supabase: SupabaseClient,
  params: {
    queueId: string;
    prNumber: number;
    prSha: string;
    prTitle: string | null;
    prAuthor: string | null;
    branchName: string | null;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("enqueue_merge_queue_entry", {
    p_queue_id: params.queueId,
    p_pr_number: params.prNumber,
    p_pr_sha: params.prSha,
    p_pr_title: params.prTitle,
    p_pr_author: params.prAuthor,
    p_branch_name: params.branchName,
  });
  if (error) throw new Error(`failed to enqueue entry: ${error.message}`);
  return data as string;
}

export async function getEntry(
  supabase: SupabaseClient,
  queueId: string,
  prNumber: number,
): Promise<EntryRow | null> {
  const { data, error } = await supabase
    .from("merge_queue_entries")
    .select("id, queue_id, pr_number, pr_sha, pr_title, pr_author, branch_name, position, status")
    .eq("queue_id", queueId)
    .eq("pr_number", prNumber)
    .maybeSingle();
  if (error) throw new Error(`failed to load entry: ${error.message}`);
  return data as EntryRow | null;
}

export async function getEntriesByIds(
  supabase: SupabaseClient,
  entryIds: string[],
): Promise<EntryRow[]> {
  if (entryIds.length === 0) return [];
  const { data, error } = await supabase
    .from("merge_queue_entries")
    .select("id, queue_id, pr_number, pr_sha, pr_title, pr_author, branch_name, position, status")
    .in("id", entryIds)
    .order("position", { ascending: true });
  if (error) throw new Error(`failed to load entries: ${error.message}`);
  return (data ?? []) as EntryRow[];
}

export async function updateEntryStatus(
  supabase: SupabaseClient,
  entryId: string,
  status: EntryStatus,
  fields: { failureReason?: string | null; prSha?: string; mergedAt?: string } = {},
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if ("failureReason" in fields) update.failure_reason = fields.failureReason;
  if (fields.prSha !== undefined) update.pr_sha = fields.prSha;
  if (fields.mergedAt !== undefined) update.merged_at = fields.mergedAt;

  const { error } = await supabase
    .from("merge_queue_entries")
    .update(update)
    .eq("id", entryId);
  if (error) throw new Error(`failed to update entry ${entryId}: ${error.message}`);
}

export async function resetEntriesToQueued(
  supabase: SupabaseClient,
  entryIds: string[],
): Promise<void> {
  if (entryIds.length === 0) return;
  const { error } = await supabase
    .from("merge_queue_entries")
    .update({ status: "queued", updated_at: new Date().toISOString() })
    .in("id", entryIds)
    .eq("status", "testing");
  if (error) throw new Error(`failed to reset entries: ${error.message}`);
}

export async function setBisectMode(
  supabase: SupabaseClient,
  queueId: string,
  bisectMode: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("merge_queues")
    .update({ bisect_mode: bisectMode, updated_at: new Date().toISOString() })
    .eq("id", queueId);
  if (error) throw new Error(`failed to set bisect mode: ${error.message}`);
}

export async function countQueuedEntries(
  supabase: SupabaseClient,
  queueId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("merge_queue_entries")
    .select("id", { count: "exact", head: true })
    .eq("queue_id", queueId)
    .eq("status", "queued");
  if (error) throw new Error(`failed to count queued entries: ${error.message}`);
  return count ?? 0;
}
