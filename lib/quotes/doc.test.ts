import { describe, it, expect } from "vitest";
import {
  computeTotals,
  derivedStatus,
  fmtMoney,
  formatQuoteAmount,
  isExpired,
  linePath,
  type QuoteSection,
} from "./doc";

const setup: QuoteSection = {
  id: "setup",
  title: "Section 1 — Once-off Setup Costs",
  totalLabel: "Total (incl VAT)",
  groups: [
    {
      name: "Handsets",
      items: [
        { description: "Fanvil V61G", qty: 1, unitPrice: 968.75 },
        { description: "Fanvil V60P", qty: 3, unitPrice: 812.5 },
      ],
    },
    { name: "Cabling", items: [{ description: "Cat6 point", qty: 4, unitPrice: 750 }] },
  ],
};

const recurring: QuoteSection = {
  id: "recurring",
  title: "Section 2 — Monthly Recurring Costs",
  totalLabel: "Monthly Total (incl VAT)",
  groups: [
    {
      name: "",
      items: [
        { description: "VoIP extension", qty: 4, unitPrice: 99 },
        // usage-based line: never counts toward totals
        { description: "Call charges", qty: null, unitPrice: null, usageNote: "R0.50 / min", totalNote: "Usage-based" },
      ],
    },
  ],
};

describe("computeTotals", () => {
  it("computes once-off and monthly sections separately, skipping usage lines", () => {
    const t = computeTotals({ sections: [setup, recurring], vatPercent: 15 });
    // 968.75 + 3*812.50 + 4*750 = 6406.25
    expect(t.subtotal).toBeCloseTo(6406.25);
    expect(t.vat).toBeCloseTo(960.94, 2);
    expect(t.grand).toBeCloseTo(7367.19, 2);
    // monthly: 4*99 = 396 ex VAT → 455.40 incl
    expect(t.monthly).toBeCloseTo(455.4, 2);
    expect(t.sections.map((s) => s.monthly)).toEqual([false, true]);
  });

  it("monthly is null when there is no recurring section", () => {
    expect(computeTotals({ sections: [setup], vatPercent: 15 }).monthly).toBeNull();
  });

  it("revenueExVat sums every section's ex-VAT total, recurring included", () => {
    // once-off 6406.25 + recurring 396 = 6802.25
    expect(computeTotals({ sections: [setup, recurring], vatPercent: 15 }).revenueExVat).toBeCloseTo(6802.25, 2);
    // a recurring-only quote: revenue is the monthly ex-VAT, not zero
    expect(computeTotals({ sections: [recurring], vatPercent: 15 }).revenueExVat).toBeCloseTo(396, 2);
  });

  it("respects an explicit monthly flag over the id convention", () => {
    const t = computeTotals({
      sections: [{ ...setup, id: "anything", monthly: true }],
      vatPercent: 15,
    });
    expect(t.monthly).toBeCloseTo(7367.19, 2);
    expect(t.grand).toBe(0);
  });
});

describe("fmtMoney", () => {
  it("formats rands with two decimals", () => {
    expect(fmtMoney(968.75)).toMatch(/^R\s.*968[.,]75$/);
    expect(fmtMoney(null)).toBe("—");
  });
});

describe("formatQuoteAmount", () => {
  it("shows the once-off total for a once-off quote", () => {
    expect(formatQuoteAmount(5750, null)).toMatch(/^R\s.*5\s?750[.,]00$/);
  });
  it("shows the monthly total for a recurring-only quote (no R0,00 once-off)", () => {
    expect(formatQuoteAmount(0, 2300)).toMatch(/^R\s.*2\s?300[.,]00 \/ mo$/);
  });
  it("shows both when a quote has once-off and recurring", () => {
    expect(formatQuoteAmount(1000, 500)).toMatch(/1\s?000[.,]00 \+ R\s.*500[.,]00 \/ mo$/);
  });
  it("honours a custom per-period label", () => {
    expect(formatQuoteAmount(0, 2300, { per: "month" })).toMatch(/2\s?300[.,]00 \/ month$/);
  });
  it("falls back to R0,00 when there is nothing, and — when null", () => {
    expect(formatQuoteAmount(0, null)).toMatch(/0[.,]00$/);
    expect(formatQuoteAmount(null, null)).toBe("—");
  });
});

describe("expiry", () => {
  const today = new Date("2026-06-11T12:00:00Z");
  it("expires only after the valid-until day", () => {
    expect(isExpired("2026-06-10", today)).toBe(true);
    expect(isExpired("2026-06-11", today)).toBe(false);
    expect(isExpired(null, today)).toBe(false);
  });
  it("derives expired only for sent quotes", () => {
    expect(derivedStatus("sent", "2026-06-01", today)).toBe("expired");
    expect(derivedStatus("accepted", "2026-06-01", today)).toBe("accepted");
    expect(derivedStatus("sent", "2026-07-01", today)).toBe("sent");
  });
});

describe("linePath", () => {
  it("addresses items stably", () => {
    expect(linePath(0, 1, 2)).toBe("s0.g1.i2");
  });
});
