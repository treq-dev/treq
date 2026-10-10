import { describe, expect, it, vi } from "vitest";
import {
  buildCheckoutSessionParams,
  parseCheckoutBody,
} from "../../supabase/functions/_shared/billing/checkout.ts";
import {
  createStripeClient,
  encodeStripeForm,
  STRIPE_API_VERSION,
  StripeApiError,
  type StripeClient,
  type StripeParams,
} from "../../supabase/functions/_shared/billing/stripe-api.ts";
import type { BillingStore } from "../../supabase/functions/_shared/billing/store.ts";
import { createCheckout } from "../../supabase/functions/billing-checkout/lib.ts";
import { createPortal } from "../../supabase/functions/billing-portal/lib.ts";

const USER_ID = "6f1c1f4e-6a8f-4a39-9d55-2b1f0b3f9a10";
const WEB_URL = "https://treq.dev";

describe("buildCheckoutSessionParams", () => {
  const base = {
    customerId: "cus_123",
    priceId: "price_pro",
    ownerId: USER_ID,
    webUrl: WEB_URL,
  };

  it("builds an embedded subscription session with a 14-day trial", () => {
    expect(
      buildCheckoutSessionParams({ ...base, trialEligible: true }),
    ).toEqual({
      ui_mode: "embedded",
      mode: "subscription",
      customer: "cus_123",
      "line_items[0][price]": "price_pro",
      "line_items[0][quantity]": 1,
      payment_method_collection: "always",
      client_reference_id: USER_ID,
      "metadata[owner_type]": "user",
      "metadata[owner_id]": USER_ID,
      "subscription_data[metadata][owner_type]": "user",
      "subscription_data[metadata][owner_id]": USER_ID,
      return_url:
        "https://treq.dev/dashboard?tab=subscription&session_id={CHECKOUT_SESSION_ID}",
      "subscription_data[trial_period_days]": 14,
    });
  });

  it("leaves the trial out once the owner has used it", () => {
    const params = buildCheckoutSessionParams({
      ...base,
      trialEligible: false,
    });
    expect(params).not.toHaveProperty("subscription_data[trial_period_days]");
    expect(params.payment_method_collection).toBe("always");
  });

  it("drops a trailing slash from the web URL", () => {
    expect(
      buildCheckoutSessionParams({
        ...base,
        webUrl: "http://localhost:3001/",
        trialEligible: true,
      }).return_url,
    ).toBe(
      "http://localhost:3001/dashboard?tab=subscription&session_id={CHECKOUT_SESSION_ID}",
    );
  });
});

describe("encodeStripeForm", () => {
  it("form-encodes bracketed keys and the session id placeholder", () => {
    expect(
      encodeStripeForm({
        "line_items[0][price]": "price_pro",
        return_url: "https://treq.dev/x?session_id={CHECKOUT_SESSION_ID}",
        flag: true,
      }),
    ).toBe(
      "line_items%5B0%5D%5Bprice%5D=price_pro&return_url=https%3A%2F%2Ftreq.dev%2Fx%3Fsession_id%3D%7BCHECKOUT_SESSION_ID%7D&flag=true",
    );
  });
});

describe("parseCheckoutBody", () => {
  it("accepts Pro", () => {
    expect(parseCheckoutBody({ plan: "pro" })).toEqual({
      ok: true,
      plan: "pro",
    });
  });

  it("rejects Team until organizations ship", () => {
    const result = parseCheckoutBody({ plan: "team" });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(!result.ok && result.error).toMatch(/organization/i);
  });

  it.each([
    [{}],
    [{ plan: "enterprise" }],
    [null],
    ["pro"],
  ])("rejects %j", (body) => {
    expect(parseCheckoutBody(body)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("createStripeClient", () => {
  it("pins the API version that still accepts ui_mode=embedded", () => {
    // @stripe/stripe-js 8 (release train "clover") provides
    // initEmbeddedCheckout. Later trains rename embedded Checkout.
    expect(STRIPE_API_VERSION).toMatch(/\.clover$/);
  });

  it("posts a form with the secret key and an idempotency key", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "cus_1" }), { status: 200 }),
    );
    const stripe = createStripeClient("sk_test_123", fetchMock);
    await expect(
      stripe.request(
        "POST",
        "/v1/customers",
        { email: "a@b.c" },
        {
          idempotencyKey: "key-1",
        },
      ),
    ).resolves.toEqual({ id: "cus_1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/customers",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer sk_test_123",
          "Stripe-Version": STRIPE_API_VERSION,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": "key-1",
        },
        body: "email=a%40b.c",
      },
    );
  });

  it("puts GET parameters in the query string", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    const stripe = createStripeClient("sk_test_123", fetchMock);
    await stripe.request("GET", "/v1/prices", {
      "lookup_keys[0]": "treq_pro_monthly",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/prices?lookup_keys%5B0%5D=treq_pro_monthly",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer sk_test_123",
          "Stripe-Version": STRIPE_API_VERSION,
        },
      },
    );
  });

  it("raises Stripe's error message", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: "No such price", type: "invalid_request_error" },
          }),
          { status: 400 },
        ),
    );
    const stripe = createStripeClient("sk_test_123", fetchMock);
    const error = await stripe.request("GET", "/v1/prices/x").catch((e) => e);
    expect(error).toBeInstanceOf(StripeApiError);
    expect(error).toMatchObject({ status: 400, message: "No such price" });
  });
});

type Call = {
  method: string;
  path: string;
  params?: StripeParams;
  idempotencyKey?: string;
};

function fakeStripe(responses: Record<string, unknown>): {
  stripe: StripeClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    stripe: {
      request: async (method, path, params, options) => {
        calls.push({
          method,
          path,
          params,
          idempotencyKey: options?.idempotencyKey,
        });
        const response = responses[`${method} ${path}`];
        if (response instanceof Error) throw response;
        if (response === undefined)
          throw new Error(`unexpected ${method} ${path}`);
        return response;
      },
    } as StripeClient,
  };
}

function fakeStore(overrides: Partial<BillingStore> = {}): BillingStore {
  return {
    hasPro: vi.fn(async () => false),
    getCustomer: vi.fn(async () => null),
    attachCustomer: vi.fn(async (id: string) => id),
    ...overrides,
  };
}

const STRIPE_OK = {
  "POST /v1/customers": { id: "cus_new" },
  "GET /v1/prices": {
    data: [{ id: "price_pro", lookup_key: "treq_pro_monthly" }],
  },
  "POST /v1/checkout/sessions": {
    id: "cs_1",
    client_secret: "cs_1_secret_abc",
  },
};

function sessionParams(calls: Call[]): StripeParams | undefined {
  return calls.find((c) => c.path === "/v1/checkout/sessions")?.params;
}

describe("createCheckout", () => {
  const user = { id: USER_ID, email: "dev@example.com" };

  it("creates and records a customer, then offers the trial", async () => {
    const { stripe, calls } = fakeStripe(STRIPE_OK);
    const store = fakeStore({
      getCustomer: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
        stripe_customer_id: "cus_new",
        trial_used_at: null,
      }),
    });
    const result = await createCheckout(
      { plan: "pro" },
      { user, store, stripe, webUrl: WEB_URL },
    );

    expect(result).toEqual({
      status: 200,
      body: { client_secret: "cs_1_secret_abc" },
    });
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/v1/customers",
      params: {
        email: "dev@example.com",
        "metadata[owner_type]": "user",
        "metadata[owner_id]": USER_ID,
      },
      idempotencyKey: `treq-customer-user-${USER_ID}`,
    });
    expect(store.attachCustomer).toHaveBeenCalledWith("cus_new");
    expect(sessionParams(calls)).toMatchObject({
      customer: "cus_new",
      "subscription_data[trial_period_days]": 14,
    });
  });

  it("uses the customer another checkout recorded first", async () => {
    const { stripe, calls } = fakeStripe(STRIPE_OK);
    const store = fakeStore({
      attachCustomer: vi.fn(async () => "cus_won_race"),
      getCustomer: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
        stripe_customer_id: "cus_won_race",
        trial_used_at: null,
      }),
    });
    await createCheckout(
      { plan: "pro" },
      { user, store, stripe, webUrl: WEB_URL },
    );
    expect(sessionParams(calls)?.customer).toBe("cus_won_race");
  });

  it("reuses an existing customer without creating another", async () => {
    const { stripe, calls } = fakeStripe(STRIPE_OK);
    const store = fakeStore({
      getCustomer: vi.fn(async () => ({
        stripe_customer_id: "cus_old",
        trial_used_at: null,
      })),
    });
    await createCheckout(
      { plan: "pro" },
      { user, store, stripe, webUrl: WEB_URL },
    );
    expect(calls.map((c) => c.path)).toEqual([
      "/v1/prices",
      "/v1/checkout/sessions",
    ]);
    expect(sessionParams(calls)).toMatchObject({
      customer: "cus_old",
      "subscription_data[trial_period_days]": 14,
    });
    expect(store.attachCustomer).not.toHaveBeenCalled();
  });

  it("offers no trial once trial_used_at is set", async () => {
    const { stripe, calls } = fakeStripe(STRIPE_OK);
    const store = fakeStore({
      getCustomer: vi.fn(async () => ({
        stripe_customer_id: "cus_old",
        trial_used_at: "2026-09-01T00:00:00Z",
      })),
    });
    const result = await createCheckout(
      { plan: "pro" },
      { user, store, stripe, webUrl: WEB_URL },
    );
    expect(result.status).toBe(200);
    expect(sessionParams(calls)).not.toHaveProperty(
      "subscription_data[trial_period_days]",
    );
  });

  it("resolves the price by lookup key", async () => {
    const { stripe, calls } = fakeStripe(STRIPE_OK);
    const store = fakeStore({
      getCustomer: vi.fn(async () => ({
        stripe_customer_id: "cus_old",
        trial_used_at: null,
      })),
    });
    await createCheckout(
      { plan: "pro" },
      { user, store, stripe, webUrl: WEB_URL },
    );
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/v1/prices",
      params: { "lookup_keys[0]": "treq_pro_monthly", active: true, limit: 1 },
      idempotencyKey: undefined,
    });
    expect(sessionParams(calls)?.["line_items[0][price]"]).toBe("price_pro");
  });

  it("refuses a second subscription for someone who already has Pro", async () => {
    const { stripe, calls } = fakeStripe(STRIPE_OK);
    const store = fakeStore({ hasPro: vi.fn(async () => true) });
    const result = await createCheckout(
      { plan: "pro" },
      { user, store, stripe, webUrl: WEB_URL },
    );
    expect(result.status).toBe(409);
    expect(calls).toEqual([]);
  });

  it("rejects Team before touching Stripe", async () => {
    const { stripe, calls } = fakeStripe(STRIPE_OK);
    const result = await createCheckout(
      { plan: "team" },
      { user, store: fakeStore(), stripe, webUrl: WEB_URL },
    );
    expect(result.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("fails clearly when the Pro price is missing", async () => {
    const { stripe } = fakeStripe({
      ...STRIPE_OK,
      "GET /v1/prices": { data: [] },
    });
    const store = fakeStore({
      getCustomer: vi.fn(async () => ({
        stripe_customer_id: "cus_old",
        trial_used_at: null,
      })),
    });
    const result = await createCheckout(
      { plan: "pro" },
      { user, store, stripe, webUrl: WEB_URL },
    );
    expect(result).toEqual({
      status: 500,
      body: { error: "The Pro price is not configured" },
    });
  });

  it("returns 502 when Stripe fails", async () => {
    const { stripe } = fakeStripe({
      ...STRIPE_OK,
      "POST /v1/checkout/sessions": new StripeApiError(500, "Stripe is down"),
    });
    const store = fakeStore({
      getCustomer: vi.fn(async () => ({
        stripe_customer_id: "cus_old",
        trial_used_at: null,
      })),
    });
    const result = await createCheckout(
      { plan: "pro" },
      { user, store, stripe, webUrl: WEB_URL },
    );
    expect(result.status).toBe(502);
  });
});

describe("createPortal", () => {
  it("returns 404 when the user has no Stripe customer", async () => {
    const { stripe, calls } = fakeStripe({});
    const result = await createPortal({
      store: fakeStore(),
      stripe,
      webUrl: WEB_URL,
    });
    expect(result.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("opens a portal session for the user's customer", async () => {
    const { stripe, calls } = fakeStripe({
      "POST /v1/billing_portal/sessions": {
        url: "https://billing.stripe.com/p/session/abc",
      },
    });
    const store = fakeStore({
      getCustomer: vi.fn(async () => ({
        stripe_customer_id: "cus_old",
        trial_used_at: null,
      })),
    });
    const result = await createPortal({ store, stripe, webUrl: WEB_URL });
    expect(result).toEqual({
      status: 200,
      body: { url: "https://billing.stripe.com/p/session/abc" },
    });
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/v1/billing_portal/sessions",
        params: {
          customer: "cus_old",
          return_url: "https://treq.dev/dashboard?tab=subscription",
        },
        idempotencyKey: undefined,
      },
    ]);
  });
});
