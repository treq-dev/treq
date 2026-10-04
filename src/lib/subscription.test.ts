import { describe, expect, it } from "vitest";
import { isProSubscription } from "./subscription";

const now = new Date("2026-10-04T00:00:00Z");
const sub = (status: string, plan = "pro", periodEnd: string | null = null) =>
  ({ status, plan, current_period_end: periodEnd }) as never;

describe("isProSubscription", () => {
  it("accepts active, trialing and past_due Pro plans", () => {
    for (const s of ["active", "trialing", "past_due"]) {
      expect(isProSubscription(sub(s), now)).toBe(true);
    }
  });
  it("rejects free plans and missing subscriptions", () => {
    expect(isProSubscription(sub("active", "free"), now)).toBe(false);
    expect(isProSubscription(null, now)).toBe(false);
    expect(isProSubscription(sub("inactive"), now)).toBe(false);
  });
  it("keeps a canceled plan Pro until its period ends", () => {
    expect(
      isProSubscription(sub("canceled", "pro", "2026-11-01T00:00:00Z"), now),
    ).toBe(true);
    expect(
      isProSubscription(sub("canceled", "pro", "2026-09-01T00:00:00Z"), now),
    ).toBe(false);
    expect(isProSubscription(sub("canceled"), now)).toBe(false);
  });
});
