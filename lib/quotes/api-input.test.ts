import { describe, expect, it } from "vitest";
import { computeTotals } from "./doc.ts";
import {
  assembleAmend,
  assembleCreate,
  round2,
  type ApiAmendBody,
  type ApiCreateBody,
  type ClientContext,
} from "./api-input.ts";
import { CHECKOUT_PAYMENT_TERM, EFT_PAYMENT_TERM, STANDARD_TERMS } from "./api-template.ts";

const TODAY = new Date("2026-08-13T00:00:00.000Z");
const OPTS = { today: TODAY, actorLabel: "Shawn Jooste" };

const SUN_FIXTURE: ApiCreateBody = {
  client: "Sun Destinations",
  title: "Windows 11 Pro Licence",
  items: [
    {
      description: "Microsoft Windows 11 Professional — Licence",
      detail: "One Windows 11 Professional licence, supplied with its activation key.",
      qty: 1,
      supplierCostExVat: 2299,
    },
  ],
  summaryNote:
    "Supply of the licence and key only — installation and configuration are not included and would be quoted or billed separately if needed.",
  extraTerms: ["Licence keys are issued once payment is received and are non-refundable once issued."],
  checkout: true,
};

const SUN_CLIENT: ClientContext = {
  id: "c1",
  name: "Sun Destinations",
  registeredName: "Sun Destinations (Pty) Ltd",
  attention: "Monique",
  addressLines: ["Unit F2 Westlake Square", "Westlake Drive, Westlake", "Cape Town, 7945"],
};

describe("assembleCreate — golden fixture (QU-SUN-002)", () => {
  it("assembles a doc matching the live company/banking/section shape and totals", () => {
    const result = assembleCreate(SUN_FIXTURE, SUN_CLIENT, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { doc, internal } = result.input;
    expect(doc.company).toEqual({
      name: "Rocking (PTY) LTD",
      addressLines: ["Unit A3, Westlake Square", "Westlake Drive, Westlake, 7945"],
      vat: "4810312173",
      regNumber: "2013/047237/07",
      registeredOffice: "Unit A3, Westlake Square, Westlake Drive, Westlake, 7945, South Africa",
    });
    expect(doc.banking).toEqual({
      bank: "First National Bank",
      account: "63023869192",
      branch: "Blue Route Mall, Tokai Road, Tokai, 7945",
      branchCode: "250655",
      reference: "Please use quote number as payment reference.",
    });

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].id).toBe("supply");
    expect(doc.sections[0].groups[0].items).toHaveLength(1);
    expect(doc.sections[0].groups[0].items[0].unitPrice).toBe(2643.85);

    expect(computeTotals(doc).grand).toBeCloseTo(3040.4275, 4);

    expect(internal).toHaveLength(1);
    expect(internal![0].path).toBe("s0.g0.i0");
    expect(internal![0].supplierCost).toBe(2299);
    expect(internal![0].note).toContain("2299");
  });
});

describe("round2 markup edges", () => {
  it("2299 -> 2643.85", () => expect(round2(2299 * 1.15)).toBe(2643.85));
  it("1000 -> 1150", () => expect(round2(1000 * 1.15)).toBe(1150));
  it("999.99 -> 1149.99", () => expect(round2(999.99 * 1.15)).toBe(round2(1149.9885)));
  it("0.01 -> 0.01", () => expect(round2(0.01 * 1.15)).toBe(0.01));
});

const BASE_CLIENT: ClientContext = { id: "c1", name: "Acme" };

function baseBody(overrides: Partial<ApiCreateBody> = {}): ApiCreateBody {
  return {
    title: "Test Quote",
    items: [{ description: "Widget", qty: 1, supplierCostExVat: 100 }],
    ...overrides,
  };
}

describe("XOR: exactly one of supplierCostExVat/unitPriceExVat", () => {
  it("both given -> error naming the item index", () => {
    const body = baseBody({
      items: [{ description: "Widget", qty: 1, supplierCostExVat: 100, unitPriceExVat: 150 }],
    });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items[0].price")).toBe(true);
  });

  it("neither given -> error naming the item index", () => {
    const body = baseBody({ items: [{ description: "Widget", qty: 1 }] });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items[0].price")).toBe(true);
  });
});

describe("other validation", () => {
  it("empty title -> error", () => {
    const result = assembleCreate(baseBody({ title: "  " }), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "title")).toBe(true);
  });

  it("empty items -> error", () => {
    const result = assembleCreate(baseBody({ items: [] }), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items")).toBe(true);
  });

  it("qty < 1 -> error", () => {
    const body = baseBody({ items: [{ description: "Widget", qty: 0, supplierCostExVat: 10 }] });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items[0].qty")).toBe(true);
  });

  it("negative supplierCostExVat -> error", () => {
    const body = baseBody({ items: [{ description: "Widget", qty: 1, supplierCostExVat: -5 }] });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items[0].supplierCostExVat")).toBe(true);
  });

  it("negative unitPriceExVat -> error", () => {
    const body = baseBody({ items: [{ description: "Widget", qty: 1, unitPriceExVat: -1 }] });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items[0].unitPriceExVat")).toBe(true);
  });

  it("supplierCostExVat as an object (not a number) -> error, never a crash", () => {
    const body = baseBody({
      // @ts-expect-error deliberately malformed to exercise runtime validation
      items: [{ description: "Widget", qty: 1, supplierCostExVat: {} }],
    });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items[0].supplierCostExVat")).toBe(true);
  });

  it("supplierCostExVat: 0 -> error (must be > 0)", () => {
    const body = baseBody({ items: [{ description: "Widget", qty: 1, supplierCostExVat: 0 }] });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items[0].supplierCostExVat")).toBe(true);
  });

  it("description as an object (not a string) -> error, never a crash", () => {
    const body = baseBody({
      // @ts-expect-error deliberately malformed to exercise runtime validation
      items: [{ description: {}, qty: 1, supplierCostExVat: 10 }],
    });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items[0].description")).toBe(true);
  });

  it("detail as a number (not a string) -> error", () => {
    const body = baseBody({
      // @ts-expect-error deliberately malformed to exercise runtime validation
      items: [{ description: "Widget", detail: 5, qty: 1, supplierCostExVat: 10 }],
    });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items[0].detail")).toBe(true);
  });

  it("items as a string (not an array) -> error naming 'items', never a crash", () => {
    const result = assembleCreate(
      {
        title: "Test Quote",
        // @ts-expect-error deliberately malformed to exercise runtime validation
        items: "not an array",
      },
      BASE_CLIENT,
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "items")).toBe(true);
  });

  it("extraTerms as an object (not an array of strings) -> error", () => {
    const body = baseBody({
      // @ts-expect-error deliberately malformed to exercise runtime validation
      extraTerms: {},
    });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "extraTerms")).toBe(true);
  });

  it("extraTerms containing a non-string element -> error", () => {
    const body = baseBody({
      // @ts-expect-error deliberately malformed to exercise runtime validation
      extraTerms: ["fine", 5],
    });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "extraTerms")).toBe(true);
  });

  it("intro as an object (not a string) -> error", () => {
    const body = baseBody({
      // @ts-expect-error deliberately malformed to exercise runtime validation
      intro: { not: "a string" },
    });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "intro")).toBe(true);
  });

  it("title containing a control character -> error", () => {
    const body = baseBody({ title: "BadTitle" });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "title")).toBe(true);
  });

  it("title exceeding 200 characters -> error", () => {
    const body = baseBody({ title: "x".repeat(201) });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "title")).toBe(true);
  });

  it("title at exactly 200 characters is allowed", () => {
    const body = baseBody({ title: "x".repeat(200) });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
  });

  it("validUntil not yyyy-mm-dd -> error", () => {
    const result = assembleCreate(baseBody({ validUntil: "13 August 2026" }), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "validUntil")).toBe(true);
  });

  it("validUntil before today -> error", () => {
    const result = assembleCreate(baseBody({ validUntil: "2026-08-01" }), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === "validUntil")).toBe(true);
  });

  it("validUntil equal to today is allowed (not before today)", () => {
    const result = assembleCreate(baseBody({ validUntil: "2026-08-13" }), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
  });

  it("collects multiple errors in one call", () => {
    const body: ApiCreateBody = { title: "", items: [] };
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("generated defaults", () => {
  it("null intro generates the non-checkout line", () => {
    const result = assembleCreate(baseBody({ intro: null }), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.doc.projectIntro).toBe("This quote covers Test Quote. All prices exclude VAT (15%).");
  });

  it("null intro generates the checkout line", () => {
    const result = assembleCreate(baseBody({ intro: null, checkout: true }), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.doc.projectIntro).toBe(
      "This quote covers Test Quote, payable online by card. All prices exclude VAT (15%).",
    );
  });

  it("explicit intro is used verbatim", () => {
    const result = assembleCreate(baseBody({ intro: "Custom intro." }), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.doc.projectIntro).toBe("Custom intro.");
  });

  it("validUntil defaults to today + 14 days in both ISO input and display doc.meta", () => {
    const result = assembleCreate(baseBody(), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.validUntil).toBe("2026-08-27");
    expect(result.input.doc.meta.validUntil).toBe("27 August 2026");
    expect(result.input.doc.meta.date).toBe("13 August 2026");
  });

  it("attention falls back: body override wins", () => {
    const client: ClientContext = { ...BASE_CLIENT, attention: "Client Contact" };
    const result = assembleCreate(baseBody({ attention: "Body Override" }), client, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.doc.client.attention).toBe("Body Override");
  });

  it("attention falls back: client context wins when body has none", () => {
    const client: ClientContext = { ...BASE_CLIENT, attention: "Client Contact" };
    const result = assembleCreate(baseBody(), client, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.doc.client.attention).toBe("Client Contact");
  });

  it("attention falls back to empty string when neither is set", () => {
    const result = assembleCreate(baseBody(), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.doc.client.attention).toBe("");
  });
});

describe("terms assembly", () => {
  it("STANDARD_TERMS is pinned verbatim, in order — template drift fails loudly", () => {
    expect(STANDARD_TERMS).toEqual([
      "This quote is valid for 14 days from the date of issue.",
      "All prices exclude VAT at 15% unless otherwise stated.",
      "Payment is due prior to order placement.",
      "Goods remain the property of Rocking until paid in full.",
    ]);
  });

  it("EFT (non-checkout): standard order unchanged, extraTerms appended after every standard term", () => {
    const result = assembleCreate(baseBody({ extraTerms: ["Extra one.", "Extra two."] }), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.doc.terms).toEqual([
      STANDARD_TERMS[0],
      STANDARD_TERMS[1],
      EFT_PAYMENT_TERM,
      ...STANDARD_TERMS.slice(3),
      "Extra one.",
      "Extra two.",
    ]);
  });

  it("checkout swaps exactly the payment term, nothing else", () => {
    const result = assembleCreate(baseBody({ checkout: true }), BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.doc.terms).toEqual([
      STANDARD_TERMS[0],
      STANDARD_TERMS[1],
      CHECKOUT_PAYMENT_TERM,
      ...STANDARD_TERMS.slice(3),
    ]);
  });
});

describe("monthly routing", () => {
  it("mixed items produce supply + recurring sections with correct internal paths", () => {
    const body = baseBody({
      items: [
        { description: "Once-off item", qty: 1, supplierCostExVat: 100 },
        { description: "Monthly item", qty: 1, supplierCostExVat: 50, monthly: true },
      ],
    });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { doc, internal } = result.input;
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0].id).toBe("supply");
    expect(doc.sections[0].title).toBe("Section 1 — Supply");
    expect(doc.sections[1].id).toBe("recurring");
    expect(doc.sections[1].title).toBe("Section 2 — Monthly Services");
    expect(doc.sections[1].monthly).toBe(true);
    expect(internal!.map((i) => i.path)).toEqual(["s0.g0.i0", "s1.g0.i0"]);
  });

  it("monthly-only produces a single recurring section numbered 1 with path s0.g0.i0", () => {
    const body = baseBody({
      items: [{ description: "Monthly item", qty: 1, supplierCostExVat: 50, monthly: true }],
    });
    const result = assembleCreate(body, BASE_CLIENT, OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { doc, internal } = result.input;
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].id).toBe("recurring");
    expect(doc.sections[0].title).toBe("Section 1 — Monthly Services");
    expect(internal![0].path).toBe("s0.g0.i0");
  });
});

describe("assembleAmend", () => {
  it("the type rejects a checkout flag on amend bodies (compile-time)", () => {
    // An amend of a checkout quote can only keep the term via opts.checkout,
    // never the body: checkout is not part of ApiAmendBody.
    const body: ApiAmendBody = {
      title: "Amended Quote",
      items: [{ description: "Widget", qty: 1, supplierCostExVat: 100 }],
      // @ts-expect-error checkout is not part of ApiAmendBody
      checkout: true,
    };
    expect(body.title).toBe("Amended Quote");
  });

  it("opts.checkout: true keeps the card payment term on an amend", () => {
    const result = assembleAmend(
      { title: "Amended Quote", items: [{ description: "Widget", qty: 1, supplierCostExVat: 100 }] },
      BASE_CLIENT,
      { ...OPTS, checkout: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.doc.terms[2]).toBe(CHECKOUT_PAYMENT_TERM);
  });

  it("opts.checkout: false uses the EFT payment term on an amend", () => {
    const result = assembleAmend(
      { title: "Amended Quote", items: [{ description: "Widget", qty: 1, supplierCostExVat: 100 }] },
      BASE_CLIENT,
      { ...OPTS, checkout: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.doc.terms[2]).toBe(EFT_PAYMENT_TERM);
  });

  it("amend input carries only title/doc/validUntil/internal (no clientId, no checkoutEnabled)", () => {
    const result = assembleAmend(
      { title: "Amended Quote", items: [{ description: "Widget", qty: 1, unitPriceExVat: 115 }] },
      BASE_CLIENT,
      { ...OPTS, checkout: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.input).sort()).toEqual(["doc", "internal", "title", "validUntil"]);
  });
});
