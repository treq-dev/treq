// Per-queue execution leases. A message may be processed for a queue only
// while its worker holds the queue's lease; the lease is persisted (not an
// advisory lock) because orchestration spans GitHub network calls.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";
import { LeaseContentionError } from "./errors.ts";

export const LEASE_TTL_SECONDS = 120;

export interface Lease {
  queueId: string;
  token: string;
  workerId: string;
}

export async function acquireLease(
  supabase: SupabaseClient,
  queueId: string,
  workerId: string,
  ttlSeconds = LEASE_TTL_SECONDS,
): Promise<Lease> {
  const { data, error } = await supabase.rpc("acquire_merge_queue_lease", {
    p_queue_id: queueId,
    p_worker_id: workerId,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw new Error(`failed to acquire lease for ${queueId}: ${error.message}`);
  if (!data) throw new LeaseContentionError(queueId);
  return { queueId, token: data as string, workerId };
}

export async function renewLease(
  supabase: SupabaseClient,
  lease: Lease,
  ttlSeconds = LEASE_TTL_SECONDS,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("renew_merge_queue_lease", {
    p_queue_id: lease.queueId,
    p_lease_token: lease.token,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw new Error(`failed to renew lease for ${lease.queueId}: ${error.message}`);
  return data === true;
}

export async function releaseLease(
  supabase: SupabaseClient,
  lease: Lease,
): Promise<void> {
  const { error } = await supabase.rpc("release_merge_queue_lease", {
    p_queue_id: lease.queueId,
    p_lease_token: lease.token,
  });
  if (error) {
    // Releasing a lease is best-effort; expiry reclaims it regardless.
    console.error(`[leases] failed to release lease for ${lease.queueId}: ${error.message}`);
  }
}
