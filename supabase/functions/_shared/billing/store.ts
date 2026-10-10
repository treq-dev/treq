// The billing rows billing-checkout and billing-portal need for one user,
// read and written with a service-role Supabase client. The client type is
// structural so the same code runs under Deno and in service-qa.

export type BillingCustomer = {
  stripe_customer_id: string;
  trial_used_at: string | null;
};

export interface BillingStore {
  /** has_pro for this user. */
  hasPro(): Promise<boolean>;
  getCustomer(): Promise<BillingCustomer | null>;
  /** Records the customer unless the user has one, and returns the user's customer. */
  attachCustomer(stripeCustomerId: string): Promise<string>;
}

type QueryResult = { data: unknown; error: { message: string } | null };

// supabase-js query builders are too deeply generic to match a structural
// type, so `from` stays untyped. The select below is the only use.
export interface ServiceClientLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export function billingStoreFor(
  client: ServiceClientLike,
  userId: string,
): BillingStore {
  return {
    async hasPro() {
      const { data, error } = await client.rpc("has_pro", {
        p_user_id: userId,
      });
      if (error) throw new Error(`has_pro failed: ${error.message}`);
      return data === true;
    },
    async getCustomer() {
      const { data, error }: QueryResult = await client
        .from("billing_customers")
        .select("stripe_customer_id, trial_used_at")
        .eq("owner_type", "user")
        .eq("owner_id", userId)
        .maybeSingle();
      if (error)
        throw new Error(`billing customer lookup failed: ${error.message}`);
      return (data as BillingCustomer | null) ?? null;
    },
    async attachCustomer(stripeCustomerId) {
      const { data, error } = await client.rpc("billing_attach_customer", {
        p_owner_type: "user",
        p_owner_id: userId,
        p_customer_id: stripeCustomerId,
      });
      if (error || typeof data !== "string") {
        throw new Error(
          `billing_attach_customer failed: ${error?.message ?? "no customer"}`,
        );
      }
      return data;
    },
  };
}
