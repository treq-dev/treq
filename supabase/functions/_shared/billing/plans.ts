// Plans and Stripe price lookup keys (prds/billing-and-teams.md). Prices are
// found by lookup key, never by price id, so a new price in Stripe needs no
// deploy as long as the key moves to it.

export type BillingPlan = "pro" | "team";

export const PLAN_BY_LOOKUP_KEY: Readonly<Record<string, BillingPlan>> = {
  treq_pro_monthly: "pro",
  treq_team_monthly: "team",
};

export const LOOKUP_KEY_BY_PLAN: Readonly<Record<BillingPlan, string>> = {
  pro: "treq_pro_monthly",
  team: "treq_team_monthly",
};

/** Every status Stripe documents for a subscription. */
export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
