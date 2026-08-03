import { describe, expect, it } from "vitest";
import {
  chargeReference,
  computeInitialBreakdown,
  decideCharge,
  firstOfNextMonth,
  type ChargeRow,
} from "./billing";

// All dates UTC to match the implementation's date math.
const d = (iso: string) => new Date(`${iso}T09:00:00Z`);

describe("computeInitialBreakdown", () => {
  it("mid-month signup: 20th of a 31-day month bills 9 days (23rd–31st)", () => {
    // monthly R2,000.00 ex VAT = 200000c; daily = 200000/31; 9 billable days
    const b = computeInitialBreakdown({
      onceOffExCents: 150000,
      monthlyExCents: 200000,
      vatPercent: 15,
      today: d("2026-08-20"),
    });
    expect(b.billableDays).toBe(9);
    expect(b.periodStart).toBe("2026-08-23");
    expect(b.periodEnd).toBe("2026-08-31");
    expect(b.billingPeriod).toBe("2026-08-01");
    expect(b.proRataCents).toBe(Math.round((200000 * 9) / 31)); // 58065
    expect(b.onceOffCents).toBe(150000);
    expect(b.exVatCents).toBe(150000 + 58065);
    // VAT applied once on the combined ex-VAT total
    expect(b.vatCents).toBe(Math.round(208065 * 0.15));
    expect(b.totalCents).toBe(b.exVatCents + b.vatCents);
  });

  it("grace period crossing month-end: 29th of a 30-day month → zero pro-rata", () => {
    const b = computeInitialBreakdown({
      onceOffExCents: 100000,
      monthlyExCents: 200000,
      vatPercent: 15,
      today: d("2026-09-29"), // +3 days = Oct 2 → past Sep 30
    });
    expect(b.billableDays).toBe(0);
    expect(b.proRataCents).toBe(0);
    expect(b.periodStart).toBeNull();
    expect(b.periodEnd).toBeNull();
    expect(b.exVatCents).toBe(100000);
    expect(b.vatCents).toBe(15000);
  });

  it("uses the actual month length as divisor (Feb vs Jan)", () => {
    const feb = computeInitialBreakdown({
      onceOffExCents: 0, monthlyExCents: 280000, vatPercent: 15, today: d("2026-02-10"),
    });
    // Feb 2026 has 28 days; start 13th → 16 days
    expect(feb.billableDays).toBe(16);
    expect(feb.proRataCents).toBe(Math.round((280000 * 16) / 28));

    const jan = computeInitialBreakdown({
      onceOffExCents: 0, monthlyExCents: 280000, vatPercent: 15, today: d("2026-01-10"),
    });
    // Jan has 31; start 13th → 19 days
    expect(jan.billableDays).toBe(19);
    expect(jan.proRataCents).toBe(Math.round((280000 * 19) / 31));
  });

  it("signup on the 1st of a 31-day month bills 28 days from the 4th", () => {
    const b = computeInitialBreakdown({
      onceOffExCents: 0, monthlyExCents: 310000, vatPercent: 15, today: d("2026-07-01"),
    });
    expect(b.periodStart).toBe("2026-07-04");
    expect(b.billableDays).toBe(28);
    expect(b.proRataCents).toBe(280000); // 310000/31*28 exactly
  });
});

describe("firstOfNextMonth", () => {
  it("advances into the next month, including across year-end", () => {
    expect(firstOfNextMonth(d("2026-08-20"))).toBe("2026-09-01");
    expect(firstOfNextMonth(d("2026-12-31"))).toBe("2027-01-01");
    expect(firstOfNextMonth(d("2026-09-01"))).toBe("2026-10-01");
  });
});

describe("chargeReference", () => {
  it("is deterministic per subscription, period, attempt", () => {
    expect(chargeReference("abc-123", "2026-09-01", 2)).toBe("qs-abc-123-202609-a2");
  });
});

describe("decideCharge", () => {
  const row = (over: Partial<ChargeRow>): ChargeRow => ({
    billing_period: "2026-09-01",
    status: "failed",
    attempt_number: 1,
    created_at: "2026-09-01T04:15:00Z",
    ...over,
  });

  it("no charges yet → attempt 1", () => {
    expect(decideCharge([], d("2026-09-01"))).toEqual({ action: "charge", attempt: 1 });
  });

  it("failed today → wait (retries are 2 days apart)", () => {
    expect(decideCharge([row({})], d("2026-09-01"))).toEqual({ action: "wait" });
    expect(decideCharge([row({})], d("2026-09-02"))).toEqual({ action: "wait" });
  });

  it("failed two days ago → attempt 2", () => {
    expect(decideCharge([row({})], d("2026-09-03"))).toEqual({ action: "charge", attempt: 2 });
  });

  it("third failure → exhausted", () => {
    const rows = [
      row({ attempt_number: 3, created_at: "2026-09-05T04:15:00Z" }),
      row({ attempt_number: 2, created_at: "2026-09-03T04:15:00Z" }),
      row({}),
    ];
    expect(decideCharge(rows, d("2026-09-07"))).toEqual({ action: "exhausted" });
  });

  it("success already recorded → advance", () => {
    expect(decideCharge([row({ status: "success" })], d("2026-09-02"))).toEqual({ action: "advance" });
  });

  it("pending (in-flight) row → wait", () => {
    expect(decideCharge([row({ status: "pending" })], d("2026-09-01"))).toEqual({ action: "wait" });
  });
});
