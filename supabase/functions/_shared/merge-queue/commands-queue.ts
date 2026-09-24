// PGMQ producer/consumer plumbing. All queue access goes through the
// service-role-only SECURITY DEFINER wrappers created in migration 005 —
// the pgmq schema itself is never exposed to PostgREST clients.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";
import type { DeadLetter, MergeQueueCommand } from "./messages.ts";
import { COMMAND_QUEUE, DEAD_LETTER_QUEUE } from "./messages.ts";

export interface QueueMessage {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: unknown;
}

export async function publishMergeQueueCommand(
  supabase: SupabaseClient,
  command: MergeQueueCommand,
  delaySeconds = 0,
): Promise<number> {
  const { data, error } = await supabase.rpc("merge_queue_send", {
    p_queue_name: COMMAND_QUEUE,
    p_message: command,
    p_delay_seconds: delaySeconds,
  });
  if (error) throw new Error(`failed to publish ${command.type}: ${error.message}`);
  return data as number;
}

export async function readCommandBatch(
  supabase: SupabaseClient,
  visibilityTimeoutSeconds: number,
  batchSize: number,
): Promise<QueueMessage[]> {
  const { data, error } = await supabase.rpc("merge_queue_read", {
    p_queue_name: COMMAND_QUEUE,
    p_vt_seconds: visibilityTimeoutSeconds,
    p_batch_size: batchSize,
  });
  if (error) throw new Error(`failed to read command queue: ${error.message}`);
  return (data ?? []) as QueueMessage[];
}

// Successful commands are archived (moved to pgmq's archive table), not
// deleted, so execution history remains auditable.
export async function archiveCommand(
  supabase: SupabaseClient,
  msgId: number,
): Promise<void> {
  const { error } = await supabase.rpc("merge_queue_archive", {
    p_queue_name: COMMAND_QUEUE,
    p_msg_id: msgId,
  });
  if (error) throw new Error(`failed to archive message ${msgId}: ${error.message}`);
}

// Reschedule an in-flight message to retry after `delaySeconds`.
export async function rescheduleCommand(
  supabase: SupabaseClient,
  msgId: number,
  delaySeconds: number,
): Promise<void> {
  const { error } = await supabase.rpc("merge_queue_set_vt", {
    p_queue_name: COMMAND_QUEUE,
    p_msg_id: msgId,
    p_vt_seconds: delaySeconds,
  });
  if (error) {
    throw new Error(`failed to reschedule message ${msgId}: ${error.message}`);
  }
}

export async function publishDeadLetter(
  supabase: SupabaseClient,
  deadLetter: DeadLetter,
): Promise<void> {
  const { error } = await supabase.rpc("merge_queue_send", {
    p_queue_name: DEAD_LETTER_QUEUE,
    p_message: deadLetter,
    p_delay_seconds: 0,
  });
  if (error) throw new Error(`failed to publish dead letter: ${error.message}`);
}
