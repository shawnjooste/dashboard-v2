import { describe, expect, it } from "vitest";
import { isBookingLinkStale } from "./booking-link.ts";

describe("isBookingLinkStale", () => {
  it("treats a link with no timestamp as stale", () => {
    expect(isBookingLinkStale(null)).toBe(true);
  });
  it("treats a link older than 90 days as stale", () => {
    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    expect(isBookingLinkStale(old)).toBe(true);
  });
  it("treats a fresh link as usable", () => {
    const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(isBookingLinkStale(recent)).toBe(false);
  });
});
