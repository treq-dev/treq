/**
 * Signed Stripe webhook POSTs for service-qa.
 *
 * By default the event goes to the local `functions/v1/stripe-webhook`
 * endpoint. With SERVICE_QA_NO_EDGE=1, for a local Edge runtime that cannot
 * boot functions importing `npm:` packages (for example, a sandbox whose
 * proxy the runtime does not trust), the event runs through the same handler
 * (`stripe-webhook/lib.ts`) in this process instead. Its writes still go
 * through PostgREST to the local database as the service role. Only the
 * Deno.serve wrapper in index.ts is skipped.
 */
import { signStripePayload } from "../../supabase/functions/_shared/billing/stripe-signature";
import { handleStripeWebhook } from "../../supabase/functions/stripe-webhook/lib";
import { getFunctionsBaseUrl, getServiceClient } from "./clients";

/** Must match `STRIPE_WEBHOOK_SECRET` in supabase/functions/.env (written by up.sh). */
export const SERVICE_QA_STRIPE_WEBHOOK_SECRET =
  process.env.SERVICE_QA_STRIPE_WEBHOOK_SECRET ?? "whsec_service_qa_local";

export const STRIPE_WEBHOOK_TRANSPORT: "http" | "in-process" =
  process.env.SERVICE_QA_NO_EDGE === "1" ? "in-process" : "http";

export async function postStripeEvent(
  event: Record<string, unknown>,
  opts?: { secret?: string; signature?: string | null },
): Promise<{ status: number; body: unknown }> {
  const raw = JSON.stringify(event);
  const signature =
    opts?.signature !== undefined
      ? opts.signature
      : await signStripePayload(
          raw,
          opts?.secret ?? SERVICE_QA_STRIPE_WEBHOOK_SECRET,
          Math.floor(Date.now() / 1000),
        );

  if (STRIPE_WEBHOOK_TRANSPORT === "in-process") {
    const admin = getServiceClient();
    const result = await handleStripeWebhook(
      { method: "POST", body: raw, signature },
      {
        secret: SERVICE_QA_STRIPE_WEBHOOK_SECRET,
        rpc: async (fn, args) => {
          const { data, error } = await admin.rpc(fn, args);
          return { data, error };
        },
        log: () => {},
      },
    );
    return { status: result.status, body: JSON.parse(result.body) };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature !== null) headers["Stripe-Signature"] = signature;
  const res = await fetch(`${getFunctionsBaseUrl()}/stripe-webhook`, {
    method: "POST",
    headers,
    body: raw,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep the text body.
  }
  return { status: res.status, body };
}
