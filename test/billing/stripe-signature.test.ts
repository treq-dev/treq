import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signStripePayload,
  verifyStripeSignature,
} from "../../supabase/functions/_shared/billing/stripe-signature.ts";

const SECRET = "whsec_test_secret";
const NOW = 1_790_000_000;
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "ping" });

// Signs the way Stripe documents it, with node:crypto rather than the code
// under test.
function stripeV1(payload: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
}

describe("verifyStripeSignature", () => {
  it("accepts a valid signature", async () => {
    const header = `t=${NOW},v1=${stripeV1(PAYLOAD, SECRET, NOW)}`;
    expect(
      await verifyStripeSignature(PAYLOAD, header, SECRET, { nowSeconds: NOW }),
    ).toEqual({ ok: true, timestamp: NOW });
  });

  it("rejects a signature made with another secret", async () => {
    const header = `t=${NOW},v1=${stripeV1(PAYLOAD, "whsec_other", NOW)}`;
    expect(
      await verifyStripeSignature(PAYLOAD, header, SECRET, { nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("rejects a body changed after signing", async () => {
    const header = `t=${NOW},v1=${stripeV1(PAYLOAD, SECRET, NOW)}`;
    const tampered = PAYLOAD.replace("ping", "pong");
    expect(
      await verifyStripeSignature(tampered, header, SECRET, {
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("rejects a timestamp changed after signing", async () => {
    const header = `t=${NOW + 1},v1=${stripeV1(PAYLOAD, SECRET, NOW)}`;
    expect(
      await verifyStripeSignature(PAYLOAD, header, SECRET, { nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("rejects a valid signature older than five minutes", async () => {
    const signedAt = NOW - 301;
    const header = `t=${signedAt},v1=${stripeV1(PAYLOAD, SECRET, signedAt)}`;
    expect(
      await verifyStripeSignature(PAYLOAD, header, SECRET, { nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("rejects a valid signature dated more than five minutes ahead", async () => {
    const signedAt = NOW + 301;
    const header = `t=${signedAt},v1=${stripeV1(PAYLOAD, SECRET, signedAt)}`;
    expect(
      await verifyStripeSignature(PAYLOAD, header, SECRET, { nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("accepts a signature at the edge of the tolerance", async () => {
    const signedAt = NOW - 300;
    const header = `t=${signedAt},v1=${stripeV1(PAYLOAD, SECRET, signedAt)}`;
    expect(
      (
        await verifyStripeSignature(PAYLOAD, header, SECRET, {
          nowSeconds: NOW,
        })
      ).ok,
    ).toBe(true);
  });

  it("accepts any matching v1 when Stripe sends several during secret rotation", async () => {
    const header = [
      `t=${NOW}`,
      `v1=${stripeV1(PAYLOAD, "whsec_old", NOW)}`,
      `v1=${stripeV1(PAYLOAD, SECRET, NOW)}`,
      `v0=${"0".repeat(64)}`,
    ].join(",");
    expect(
      (
        await verifyStripeSignature(PAYLOAD, header, SECRET, {
          nowSeconds: NOW,
        })
      ).ok,
    ).toBe(true);
  });

  it("rejects several v1 values when none matches", async () => {
    const header = [
      `t=${NOW}`,
      `v1=${stripeV1(PAYLOAD, "whsec_old", NOW)}`,
      `v1=${stripeV1(PAYLOAD, "whsec_older", NOW)}`,
    ].join(",");
    expect(
      await verifyStripeSignature(PAYLOAD, header, SECRET, { nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("ignores v0 signatures", async () => {
    const header = `t=${NOW},v0=${stripeV1(PAYLOAD, SECRET, NOW)}`;
    expect(
      await verifyStripeSignature(PAYLOAD, header, SECRET, { nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "malformed_header" });
  });

  it.each([
    ["missing", null],
    ["empty", ""],
  ])("rejects a %s header", async (_label, header) => {
    expect(
      await verifyStripeSignature(PAYLOAD, header, SECRET, { nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "missing_header" });
  });

  it.each([
    ["no timestamp", `v1=${"a".repeat(64)}`],
    ["a non-numeric timestamp", `t=soon,v1=${"a".repeat(64)}`],
    ["no v1", `t=${NOW}`],
    ["garbage", "not a stripe header"],
  ])("rejects a header with %s", async (_label, header) => {
    expect(
      await verifyStripeSignature(PAYLOAD, header, SECRET, { nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "malformed_header" });
  });

  it("rejects a truncated signature", async () => {
    const header = `t=${NOW},v1=${stripeV1(PAYLOAD, SECRET, NOW).slice(0, 32)}`;
    expect(
      await verifyStripeSignature(PAYLOAD, header, SECRET, { nowSeconds: NOW }),
    ).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("refuses to verify without a secret", async () => {
    const header = `t=${NOW},v1=${stripeV1(PAYLOAD, "", NOW)}`;
    await expect(
      verifyStripeSignature(PAYLOAD, header, "", { nowSeconds: NOW }),
    ).rejects.toThrow(/secret/);
  });
});

describe("signStripePayload", () => {
  it("produces the header Stripe would send", async () => {
    expect(await signStripePayload(PAYLOAD, SECRET, NOW)).toBe(
      `t=${NOW},v1=${stripeV1(PAYLOAD, SECRET, NOW)}`,
    );
  });
});
