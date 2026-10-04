import type { Subscription } from "../stores/authStore";

const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Whether a subscription grants Pro features. A canceled plan keeps Pro until
 * its paid period ends. The google-proxy server applies the same rule.
 */
export function isProSubscription(
  sub: Pick<Subscription, "plan" | "status" | "current_period_end"> | null,
  now: Date = new Date(),
): boolean {
  if (!sub || sub.plan !== "pro") return false;
  const { status } = sub as { status: string };
  if (PRO_STATUSES.has(status)) return true;
  if (status !== "canceled" || !sub.current_period_end) return false;
  const end = Date.parse(sub.current_period_end);
  return Number.isFinite(end) && end > now.getTime();
}
