// Checkout Session parameters for Pro (prds/billing-and-teams.md,
// "Edge functions"). Kept pure so the trial and ownership rules are unit
// tested without Stripe.

import type { BillingPlan } from "./plans.ts";
import type { StripeParams } from "./stripe-api.ts";

export const PRO_TRIAL_DAYS = 14;

export type CheckoutBody =
  | { ok: true; plan: Extract<BillingPlan, "pro"> }
  | { ok: false; status: 400; error: string };

export function parseCheckoutBody(body: unknown): CheckoutBody {
  const plan =
    typeof body === "object" && body !== null
      ? (body as { plan?: unknown }).plan
      : undefined;
  if (plan === "pro") return { ok: true, plan };
  if (plan === "team") {
    return {
      ok: false,
      status: 400,
      error: "Team checkout opens when organizations ship. Choose plan 'pro'.",
    };
  }
  return { ok: false, status: 400, error: 'Body must be { "plan": "pro" }' };
}

export function checkoutReturnUrl(webUrl: string): string {
  // Stripe replaces {CHECKOUT_SESSION_ID} with the session id on return.
  return `${webUrl.replace(/\/+$/, "")}/dashboard?tab=subscription&session_id={CHECKOUT_SESSION_ID}`;
}

/**
 * The owner travels in metadata and client_reference_id. The webhook trusts
 * metadata because only this server, holding the secret key, can set it.
 * The card is always collected, so a trial converts without a second step.
 */
export function buildCheckoutSessionParams(input: {
  customerId: string;
  priceId: string;
  ownerId: string;
  trialEligible: boolean;
  webUrl: string;
}): StripeParams {
  const params: StripeParams = {
    ui_mode: "embedded",
    mode: "subscription",
    customer: input.customerId,
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": 1,
    payment_method_collection: "always",
    client_reference_id: input.ownerId,
    "metadata[owner_type]": "user",
    "metadata[owner_id]": input.ownerId,
    "subscription_data[metadata][owner_type]": "user",
    "subscription_data[metadata][owner_id]": input.ownerId,
    return_url: checkoutReturnUrl(input.webUrl),
  };
  if (input.trialEligible) {
    params["subscription_data[trial_period_days]"] = PRO_TRIAL_DAYS;
  }
  return params;
}
