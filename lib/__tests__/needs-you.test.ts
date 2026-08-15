import { describe, it, expect } from "vitest";
import { buildNeedsYou } from "../needs-you";

const quote = {
  id: "q1", quoteNumber: "Q-2026-0143", title: "Firewall replacement",
  status: "sent" as const, grandTotal: 48290, monthlyTotal: null,
  validUntil: "2026-08-19", createdAt: "2026-08-11",
};
const agreement = {
  id: "a1", reference: "AG-004", title: "Managed Services Agreement",
  status: "sent", clientId: "c1", clientName: "Networkers", createdAt: "2026-08-11",
  sentAt: "2026-08-11", signedAt: null, signerName: null, signerEmail: null, hasPdf: true,
};
const ticket = {
  id: 5, number: 1042, subject: "Printer offline", status: "active",
  preview: "The reception printer…", customerEmail: "a@b.co.za", updatedAt: "2026-08-12",
};
const empty = { quotes: [], agreements: [], failedPayments: [], tickets: [] };

describe("buildNeedsYou", () => {
  it("returns nothing when nothing is outstanding", () => {
    expect(buildNeedsYou(empty)).toEqual([]);
  });

  it("surfaces a quote awaiting decision", () => {
    const [item] = buildNeedsYou({ ...empty, quotes: [quote] });
    expect(item.kind).toBe("quote");
    expect(item.href).toBe("/quotes/q1");
    expect(item.title).toBe("Firewall replacement");
  });

  it("ignores quotes that aren't awaiting a decision", () => {
    for (const status of ["accepted", "rejected", "expired", "draft"] as const) {
      expect(buildNeedsYou({ ...empty, quotes: [{ ...quote, status }] })).toEqual([]);
    }
  });

  it("surfaces an unsigned agreement and ignores a signed one", () => {
    expect(buildNeedsYou({ ...empty, agreements: [agreement] })).toHaveLength(1);
    expect(
      buildNeedsYou({ ...empty, agreements: [{ ...agreement, signedAt: "2026-08-12" }] }),
    ).toEqual([]);
  });

  it("ignores a voided agreement even though signedAt is null", () => {
    // A void agreement never gets signed, so signedAt stays null forever —
    // status is the only signal that distinguishes it from one still
    // awaiting a decision. Without this, a voided agreement would show
    // "signature needed" with no way for the client to clear it.
    expect(
      buildNeedsYou({ ...empty, agreements: [{ ...agreement, status: "void" }] }),
    ).toEqual([]);
  });

  it("ignores a draft agreement — nothing has been sent yet", () => {
    expect(
      buildNeedsYou({ ...empty, agreements: [{ ...agreement, status: "draft" }] }),
    ).toEqual([]);
  });

  it("surfaces open tickets but not closed ones", () => {
    expect(buildNeedsYou({ ...empty, tickets: [ticket] })).toHaveLength(1);
    expect(buildNeedsYou({ ...empty, tickets: [{ ...ticket, status: "closed" }] })).toEqual([]);
  });

  it("puts a failed payment first — money problems outrank everything", () => {
    const items = buildNeedsYou({
      ...empty,
      quotes: [quote],
      tickets: [ticket],
      failedPayments: [{ id: "s1", quoteId: "q1" }],
    });
    expect(items[0].kind).toBe("payment");
    expect(items[0].urgent).toBe(true);
    expect(items[0].href).toBe("/quotes/q1/pay");
  });

  it("orders the rest: quotes, then agreements, then tickets", () => {
    const items = buildNeedsYou({
      ...empty, quotes: [quote], agreements: [agreement], tickets: [ticket],
    });
    expect(items.map((i) => i.kind)).toEqual(["quote", "agreement", "ticket"]);
  });
});
