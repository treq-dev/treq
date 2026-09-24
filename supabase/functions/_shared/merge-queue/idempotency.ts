// Command execution claims and operation-key deduplication.
//
// Identity model:
//   github_delivery_id — GitHub ingress dedupe (github_webhook_receipts)
//   command_id         — internal command dedupe (merge_queue_command_executions)
//   operation_key      — logical action dedupe (unique partial index on success)

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";

export type ClaimOutcome =
  | { kind: "claimed"; attempt: number }
  | { kind: "already_succeeded" }
  | { kind: "terminal" };

export async function claimCommandExecution(
  supabase: SupabaseClient,
  params: {
    commandId: string;
    messageId: number;
    commandType: string;
    queueId: string | null;
    operationKey: string | null;
    workerId: string;
  },
): Promise<ClaimOutcome> {
  const { data: existing, error: readError } = await supabase
    .from("merge_queue_command_executions")
    .select("status, attempt_count")
    .eq("command_id", params.commandId)
    .maybeSingle();
  if (readError) throw new Error(`failed to read execution: ${readError.message}`);

  if (existing?.status === "succeeded") return { kind: "already_succeeded" };
  if (existing?.status === "terminal_failed") return { kind: "terminal" };

  if (!existing) {
    const { error } = await supabase.from("merge_queue_command_executions").insert({
      command_id: params.commandId,
      message_id: params.messageId,
      command_type: params.commandType,
      queue_id: params.queueId,
      operation_key: params.operationKey,
      status: "processing",
      attempt_count: 1,
      worker_id: params.workerId,
    });
    if (error) {
      // Unique violation: another worker inserted concurrently. The PGMQ
      // visibility timeout means it owns this message; skip.
      if (error.code === "23505") {
        return { kind: "already_succeeded" };
      }
      throw new Error(`failed to claim execution: ${error.message}`);
    }
    return { kind: "claimed", attempt: 1 };
  }

  const attempt = (existing.attempt_count ?? 0) + 1;
  const { error } = await supabase
    .from("merge_queue_command_executions")
    .update({
      status: "processing",
      attempt_count: attempt,
      worker_id: params.workerId,
      message_id: params.messageId,
      started_at: new Date().toISOString(),
      completed_at: null,
    })
    .eq("command_id", params.commandId);
  if (error) throw new Error(`failed to re-claim execution: ${error.message}`);
  return { kind: "claimed", attempt };
}

// True when a logical operation already succeeded under any command.
export async function operationAlreadySucceeded(
  supabase: SupabaseClient,
  operationKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("merge_queue_command_executions")
    .select("command_id")
    .eq("operation_key", operationKey)
    .eq("status", "succeeded")
    .limit(1);
  if (error) throw new Error(`failed to check operation key: ${error.message}`);
  return (data ?? []).length > 0;
}

// Durably record a completed GitHub side effect (e.g. one PR merge) under
// its operation key, independent of the command that performed it. A unique
// violation means another worker already recorded it — that is success.
export async function recordOperationSuccess(
  supabase: SupabaseClient,
  params: {
    operationKey: string;
    commandType: string;
    queueId: string | null;
    workerId: string;
    result?: unknown;
  },
): Promise<void> {
  const { error } = await supabase.from("merge_queue_command_executions").insert({
    command_id: crypto.randomUUID(),
    command_type: params.commandType,
    queue_id: params.queueId,
    operation_key: params.operationKey,
    status: "succeeded",
    worker_id: params.workerId,
    completed_at: new Date().toISOString(),
    result: params.result ?? null,
  });
  if (error && error.code !== "23505") {
    throw new Error(`failed to record operation: ${error.message}`);
  }
}

export async function markExecution(
  supabase: SupabaseClient,
  commandId: string,
  status: "succeeded" | "retryable_failed" | "terminal_failed",
  fields: { lastError?: string; result?: unknown } = {},
): Promise<void> {
  const { error } = await supabase
    .from("merge_queue_command_executions")
    .update({
      status,
      completed_at: new Date().toISOString(),
      last_error: fields.lastError ?? null,
      result: fields.result ?? null,
    })
    .eq("command_id", commandId);
  if (error) throw new Error(`failed to mark execution ${status}: ${error.message}`);
}
