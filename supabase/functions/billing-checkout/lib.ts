// Request logic for billing-checkout, free of Deno and Supabase imports so it
// runs under the unit tests and service-qa. index.ts verifies the user's JWT
// and supplies the store and Stripe client.

import {
  buildCheckoutSessionParams,
  parseCheckoutBody,
} from "../_shared/billing/checkout.ts";
import { LOOKUP_KEY_BY_PLAN } from "../_shared/billing/plans.ts";
import type { BillingStore } from "../_shared/billing/store.ts";
import {
  StripeApiError,
  type StripeClient,
  type StripeParams,
} from "../_shared/billing/stripe-api.ts";

export type CheckoutDeps = {
  user: { id: string; email?: string | null };
  store: BillingStore;
  stripe: StripeClient;
  webUrl: string;
};

export type CheckoutResult = { status: number; body: Record<string, unknown> };

// Returns the user's Stripe customer, creating and recording one on first
// checkout. The idempotency key makes concurrent first checkouts share one
// Stripe customer. If they still diverge, billing_attach_customer keeps the
// first one recorded and the other stays unused in Stripe.
async function customerFor(deps: CheckoutDeps) {
  const existing = await deps.store.getCustomer();
  if (existing) return existing;

  const params: StripeParams = {};
  // The email is for Stripe receipts only. Ownership never depends on it.
  if (deps.user.email) params.email = deps.user.email;
  params["metadata[owner_type]"] = "user";
  params["metadata[owner_id]"] = deps.user.id;
  const created = await deps.stripe.request<{ id: string }>(
    "POST",
    "/v1/customers",
    params,
    { idempotencyKey: `treq-customer-user-${deps.user.id}` },
  );
  await deps.store.attachCustomer(created.id);
  const recorded = await deps.store.getCustomer();
  if (!recorded) throw new Error("billing customer was not recorded");
  return recorded;
}

export async function createCheckout(
  body: unknown,
  deps: CheckoutDeps,
): Promise<CheckoutResult> {
  const parsed = parseCheckoutBody(body);
  if (!parsed.ok)
    return { status: parsed.status, body: { error: parsed.error } };

  // One Pro subscription per user. A second one would bill twice, and a
  // second trial would stack on the first.
  if (await deps.store.hasPro()) {
    return {
      status: 409,
      body: { error: "You already have Pro. Use Manage billing to change it." },
    };
  }

  try {
    const customer = await customerFor(deps);

    const prices = await deps.stripe.request<{ data: { id: string }[] }>(
      "GET",
      "/v1/prices",
      {
        "lookup_keys[0]": LOOKUP_KEY_BY_PLAN[parsed.plan],
        active: true,
        limit: 1,
      },
    );
    const priceId = prices.data[0]?.id;
    if (!priceId) {
      return {
        status: 500,
        body: { error: "The Pro price is not configured" },
      };
    }

    const session = await deps.stripe.request<{ client_secret: string }>(
      "POST",
      "/v1/checkout/sessions",
      buildCheckoutSessionParams({
        customerId: customer.stripe_customer_id,
        priceId,
        ownerId: deps.user.id,
        trialEligible: customer.trial_used_at === null,
        webUrl: deps.webUrl,
      }),
    );
    return { status: 200, body: { client_secret: session.client_secret } };
  } catch (err) {
    if (err instanceof StripeApiError) {
      console.error(`[billing-checkout] Stripe ${err.status}: ${err.message}`);
      return { status: 502, body: { error: "Stripe request failed" } };
    }
    throw err;
  }
}
