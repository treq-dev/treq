// CI run persistence. Lane membership is owned by ci_run_entries; the
// legacy ci_runs.entry_ids array is still written for compatibility reads.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";
import type { CiRunStatus } from "./state-machine.ts";

export interface CiRunRow {
  id: string;
  queue_id: string;
  entry_ids: string[];
  head_sha: string;
  test_branch: string;
  lane_number: number;
  status: CiRunStatus;
}

export interface CiRunEntryRow {
  ci_run_id: string;
  entry_id: string;
  entry_order: number;
  tested_head_sha: string;
}

const CI_RUN_COLUMNS = "id, queue_id, entry_ids, head_sha, test_branch, lane_number, status";

export async function getCiRun(
  supabase: SupabaseClient,
  ciRunId: string,
): Promise<CiRunRow | null> {
  const { data, error } = await supabase
    .from("ci_runs")
    .select(CI_RUN_COLUMNS)
    .eq("id", ciRunId)
    .maybeSingle();
  if (error) throw new Error(`failed to load ci run ${ciRunId}: ${error.message}`);
  return data as CiRunRow | null;
}

export async function findRunningCiRunByHeadSha(
  supabase: SupabaseClient,
  headSha: string,
): Promise<CiRunRow | null> {
  const { data, error } = await supabase
    .from("ci_runs")
    .select(CI_RUN_COLUMNS)
    .eq("head_sha", headSha)
    .in("status", ["pending", "running"])
    .maybeSingle();
  if (error) throw new Error(`failed to find ci run by sha: ${error.message}`);
  return data as CiRunRow | null;
}

export async function getActiveLanes(
  supabase: SupabaseClient,
  queueId: string,
  statuses: CiRunStatus[] = ["pending", "running"],
): Promise<CiRunRow[]> {
  const { data, error } = await supabase
    .from("ci_runs")
    .select(CI_RUN_COLUMNS)
    .eq("queue_id", queueId)
    .in("status", statuses)
    .order("lane_number", { ascending: true });
  if (error) throw new Error(`failed to load active lanes: ${error.message}`);
  return (data ?? []) as CiRunRow[];
}

export async function getCiRunEntries(
  supabase: SupabaseClient,
  ciRunId: string,
): Promise<CiRunEntryRow[]> {
  const { data, error } = await supabase
    .from("ci_run_entries")
    .select("ci_run_id, entry_id, entry_order, tested_head_sha")
    .eq("ci_run_id", ciRunId)
    .order("entry_order", { ascending: true });
  if (error) throw new Error(`failed to load ci run entries: ${error.message}`);
  return (data ?? []) as CiRunEntryRow[];
}

export async function findActiveRunsContainingEntry(
  supabase: SupabaseClient,
  queueId: string,
  entryId: string,
): Promise<CiRunRow[]> {
  const { data, error } = await supabase
    .from("ci_run_entries")
    .select("ci_run_id, ci_runs!inner(id, queue_id, entry_ids, head_sha, test_branch, lane_number, status)")
    .eq("entry_id", entryId)
    .eq("ci_runs.queue_id", queueId)
    .in("ci_runs.status", ["pending", "running"]);
  if (error) throw new Error(`failed to find runs for entry: ${error.message}`);
  return (data ?? []).map(
    (row) => (row as unknown as { ci_runs: CiRunRow }).ci_runs,
  );
}

export async function updateCiRun(
  supabase: SupabaseClient,
  ciRunId: string,
  fields: {
    status?: CiRunStatus;
    headSha?: string;
    conclusion?: string;
    completedAt?: string;
  },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (fields.status !== undefined) update.status = fields.status;
  if (fields.headSha !== undefined) update.head_sha = fields.headSha;
  if (fields.conclusion !== undefined) update.conclusion = fields.conclusion;
  if (fields.completedAt !== undefined) update.completed_at = fields.completedAt;

  const { error } = await supabase.from("ci_runs").update(update).eq("id", ciRunId);
  if (error) throw new Error(`failed to update ci run ${ciRunId}: ${error.message}`);
}

// Drop an entry from a lane (e.g. it conflicted while building the batch).
export async function removeEntryFromRun(
  supabase: SupabaseClient,
  ciRunId: string,
  entryId: string,
  remainingEntryIds: string[],
): Promise<void> {
  const { error: delError } = await supabase
    .from("ci_run_entries")
    .delete()
    .eq("ci_run_id", ciRunId)
    .eq("entry_id", entryId);
  if (delError) throw new Error(`failed to remove run entry: ${delError.message}`);

  const { error } = await supabase
    .from("ci_runs")
    .update({ entry_ids: remainingEntryIds })
    .eq("id", ciRunId);
  if (error) throw new Error(`failed to update run entry_ids: ${error.message}`);
}

// Record the actual tested SHA for each entry once the batch branch is built.
export async function setTestedHeadShas(
  supabase: SupabaseClient,
  ciRunId: string,
  entryShas: Array<{ entryId: string; testedHeadSha: string }>,
): Promise<void> {
  for (const { entryId, testedHeadSha } of entryShas) {
    const { error } = await supabase
      .from("ci_run_entries")
      .update({ tested_head_sha: testedHeadSha })
      .eq("ci_run_id", ciRunId)
      .eq("entry_id", entryId);
    if (error) throw new Error(`failed to set tested sha: ${error.message}`);
  }
}
