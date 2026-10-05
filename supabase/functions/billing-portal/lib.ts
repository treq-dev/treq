// Request logic for billing-portal, free of Deno and Supabase imports so it
// runs under the unit tests and service-qa. index.ts verifies the user's JWT
// and supplies the store and Stripe client.

import type { BillingStore } from "../_shared/billing/store.ts";
import {
  StripeApiError,
  type StripeClient,
} from "../_shared/billing/stripe-api.ts";

export type PortalDeps = {
  store: Pick<BillingStore, "getCustomer">;
  stripe: StripeClient;
  webUrl: string;
};

export async function createPortal(
  deps: PortalDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const customer = await deps.store.getCustomer();
  if (!customer) {
    return { status: 404, body: { error: "No billing account for this user" } };
  }

  try {
    const session = await deps.stripe.request<{ url: string }>(
      "POST",
      "/v1/billing_portal/sessions",
      {
        customer: customer.stripe_customer_id,
        return_url: `${deps.webUrl.replace(/\/+$/, "")}/dashboard?tab=subscription`,
      },
    );
    return { status: 200, body: { url: session.url } };
  } catch (err) {
    if (err instanceof StripeApiError) {
      console.error(`[billing-portal] Stripe ${err.status}: ${err.message}`);
      return { status: 502, body: { error: "Stripe request failed" } };
    }
    throw err;
  }
}
