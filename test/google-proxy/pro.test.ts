import { describe, expect, it } from "vitest";
import { isProSubscription } from "../../supabase/functions/_shared/pro.ts";

const now = new Date("2026-10-04T12:00:00Z");

describe("isProSubscription", () => {
  it.each(["active", "trialing", "past_due"])("accepts pro + %s", (status) => {
    expect(isProSubscription({ plan: "pro", status }, now)).toBe(true);
  });

  it("accepts canceled with a future period end", () => {
    expect(
      isProSubscription(
        {
          plan: "pro",
          status: "canceled",
          current_period_end: "2026-10-05T00:00:00",
        },
        now,
      ),
    ).toBe(true);
  });

  it("rejects canceled with a past or missing period end", () => {
    expect(
      isProSubscription(
        {
          plan: "pro",
          status: "canceled",
          current_period_end: "2026-10-04T11:00:00+00:00",
        },
        now,
      ),
    ).toBe(false);
    expect(isProSubscription({ plan: "pro", status: "canceled" }, now)).toBe(
      false,
    );
  });

  it("rejects free plans, other statuses and missing rows", () => {
    expect(isProSubscription({ plan: "free", status: "active" }, now)).toBe(
      false,
    );
    expect(isProSubscription({ plan: "pro", status: "inactive" }, now)).toBe(
      false,
    );
    expect(isProSubscription({ plan: "pro", status: "unpaid" }, now)).toBe(
      false,
    );
    expect(isProSubscription(null, now)).toBe(false);
  });
});
