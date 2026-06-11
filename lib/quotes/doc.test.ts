import { describe, it, expect } from "vitest";
import {
  computeTotals,
  derivedStatus,
  fmtMoney,
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
