// The Pro rule shared by Pro-gated Edge Functions. It matches the desktop
// app's check so the gate and the UI agree.

export type SubscriptionRow = {
  plan?: string | null;
  status?: string | null;
  current_period_end?: string | null;
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * A user is Pro when the plan is "pro" and the subscription is active,
 * trialing or past due, or canceled with a period end still in the future.
 * `current_period_end` is a timestamp without zone, read as UTC.
 */
export function isProSubscription(
  row: SubscriptionRow | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!row || row.plan !== "pro" || !row.status) return false;
  if (ACTIVE_STATUSES.has(row.status)) return true;
  if (row.status !== "canceled" || !row.current_period_end) return false;
  const raw = row.current_period_end;
  const end = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  return Number.isFinite(end) && end > now.getTime();
}
