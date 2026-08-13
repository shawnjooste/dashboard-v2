import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeQuoteService } from "./service.ts";
import type { Actor } from "./policy.ts";
import { computeTotals, type QuoteDoc } from "./doc.ts";

// Mocked so we can assert POSITIVELY on what send() sends, rather than
// relying on RESEND_API_KEY being unset in the test environment (see Task 6's
// first attempt, which "verified" no email was sent only because the mock
// never intercepted the call). Same relative path service.ts itself imports.
vi.mock("../email/deliver.ts", () => ({
  deliverEmail: vi.fn(async () => ({ id: "mock-id", suppressed: [] })),
}));
import { deliverEmail } from "../email/deliver.ts";
const deliverEmailMock = vi.mocked(deliverEmail);

beforeEach(() => {
  deliverEmailMock.mockClear();
  deliverEmailMock.mockImplementation(async () => ({ id: "mock-id", suppressed: [] }));
});

const gated: Actor = { id: null, label: "Hermes", canSend: false };
const sender: Actor = { id: "p1", label: "shawn@rocking.one", canSend: true };

/** A minimal chainable query-result stub. Every method needed by service.ts's
 *  call shapes (`.eq()` any number of times, `.select()`, `.maybeSingle()`,
 *  `.single()`) returns either the same chain (so calls compose in any order)
 *  or the terminal `{ data, error }` — and the chain object itself carries
 *  `data`/`error` as own properties, so `await`-ing it directly (without an
 *  explicit terminal call) also resolves correctly, matching how Supabase's
 *  query builder is itself a thenable. */
function chain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = { data, error };
  c.eq = () => c;
  c.select = () => c;
  c.maybeSingle = async () => ({ data, error });
  c.single = async () => ({ data, error });
  return c;
}

function baseDoc(overrides: Partial<QuoteDoc> = {}): QuoteDoc {
  return {
    company: { name: "Rocking", addressLines: [], vat: "", regNumber: "", registeredOffice: "" },
    client: { name: "Acme Co", addressLines: [], attention: "" },
    meta: { quoteNumber: "", date: "2026-08-13", validUntil: "", preparedBy: "" },
    projectTitle: "Project",
    projectIntro: "",
    sections: [
      {
        id: "once-off",
        title: "Once-off",
        totalLabel: "Total",
        groups: [{ name: "Items", items: [{ description: "Widget", qty: 2, unitPrice: 100 }] }],
      },
    ],
    terms: [],
    banking: { bank: "", account: "", branch: "", branchCode: "", reference: "" },
    vatPercent: 15,
    ...overrides,
  };
}

// ---------- send() stub ----------

type SendQuoteRow = {
  id: string;
  client_id: string;
  quote_number: string;
  title: string;
  current_version: number;
  status: string;
};

/** Models exactly the tables/queries send() touches: quotes (lookup + the
 *  atomic status flip), quote_events (messageId lookup, the 'sent' insert,
 *  the resend_message_id update), profiles (active managers), and
 *  quote_versions (totals for the client email). ensureQuoteBookingLink is
 *  exercised for real (not mocked) — with CALENDLY_API_TOKEN_SHAWN unset in
 *  the test environment it no-ops (console.warn + returns null) rather than
 *  reaching the network, and its one query is against the same "quotes"
 *  table, satisfied by the same stub. */
function sbForSend(opts: {
  quote?: Partial<SendQuoteRow>;
  /** resend_message_id on the existing 'sent' quote_events row; undefined
   *  means no such row exists yet (a first send). */
  sentMessageId?: string | null;
  managers?: string[];
  versionTotals?: { grand_total: number | null; monthly_total: number | null };
  flipSucceeds?: boolean;
  eventInsertError?: { message: string } | null;
}) {
  const quote: SendQuoteRow = {
    id: "q1",
    client_id: "c1",
    quote_number: "QU-ACM-001",
    title: "VoIP System",
    current_version: 1,
    status: "draft",
    ...opts.quote,
  };
  const managers = opts.managers ?? ["mgr@acme.co"];
  const versionTotals = opts.versionTotals ?? { grand_total: 1000, monthly_total: null };
  const flipSucceeds = opts.flipSucceeds ?? true;

  const quotesUpdates: Record<string, unknown>[] = [];
  const quoteEventInserts: Record<string, unknown>[] = [];
  const quoteEventUpdates: Record<string, unknown>[] = [];

  const sb = {
    from: (table: string) => {
      if (table === "quotes") {
        return {
          select: (_cols?: string) => chain(quote),
          update: (row: Record<string, unknown>) => {
            quotesUpdates.push(row);
            return chain(flipSucceeds ? { id: quote.id } : null);
          },
        };
      }
      if (table === "quote_events") {
        return {
          select: (_cols?: string) =>
            chain(opts.sentMessageId === undefined ? null : { resend_message_id: opts.sentMessageId }),
          insert: (row: Record<string, unknown>) => {
            quoteEventInserts.push(row);
            return chain(null, opts.eventInsertError ?? null);
          },
          update: (row: Record<string, unknown>) => {
            quoteEventUpdates.push(row);
            return chain(null, null);
          },
        };
      }
      if (table === "profiles") {
        return { select: (_cols?: string) => chain(managers.map((email) => ({ email }))) };
      }
      if (table === "quote_versions") {
        return { select: (_cols?: string) => chain(versionTotals) };
      }
      throw new Error(`sbForSend: unexpected table "${table}"`);
    },
  };
  return { sb: sb as never, quote, quotesUpdates, quoteEventInserts, quoteEventUpdates };
}

describe("send authorisation", () => {
  it("refuses a caller that may not send, without touching the database", async () => {
    let touched = false;
    const sb = { from: () => { touched = true; return {} as never; } } as never;
    const res = await makeQuoteService(sb).send("q1", gated);
    expect(res).toEqual({ ok: false, error: "this caller may not send quotes" });
    expect(touched).toBe(false);
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });
});

describe("send happy path", () => {
  it("flips draft -> sent, records one 'sent' event, emails the client, and records the message id", async () => {
    const { sb, quotesUpdates, quoteEventInserts, quoteEventUpdates } = sbForSend({
      quote: { status: "draft" },
      sentMessageId: undefined,
      managers: ["mgr1@acme.co", "mgr2@acme.co"],
    });
    const res = await makeQuoteService(sb).send("q1", sender);

    expect(res).toEqual({ ok: true, sentTo: ["mgr1@acme.co", "mgr2@acme.co"] });

    expect(quotesUpdates).toHaveLength(1);
    expect(quotesUpdates[0]).toMatchObject({ status: "sent" });

    expect(quoteEventInserts).toHaveLength(1);
    expect(quoteEventInserts[0]).toMatchObject({ event: "sent", actor_profile_id: "p1" });

    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    expect(deliverEmailMock).toHaveBeenCalledWith(
      sb,
      expect.objectContaining({
        from: '"Rocky @ Rocking" <quotes@send.rocking.one>',
        to: ["mgr1@acme.co", "mgr2@acme.co"],
        cc: ["shawn@rocking.one", "accounts@rocking.one"],
        category: "quote",
        audience: "client",
      }),
    );

    expect(quoteEventUpdates).toHaveLength(1);
    expect(quoteEventUpdates[0]).toMatchObject({ resend_message_id: "<mock-id@send.rocking.one>" });
  });

  it("refuses to send from a status the client has already acted on", async () => {
    const { sb } = sbForSend({ quote: { status: "accepted" }, sentMessageId: null });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toEqual({ ok: false, error: 'cannot send a quote in status "accepted"' });
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });

  it("refuses when the flip loses a race (someone else sent it first)", async () => {
    const { sb, quoteEventInserts } = sbForSend({ quote: { status: "pending_review" }, flipSucceeds: false });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toEqual({ ok: false, error: "this quote was just sent elsewhere" });
    expect(quoteEventInserts).toHaveLength(0);
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });

  it("refuses when the client has no active managers, leaving the quote retryable", async () => {
    const { sb, quotesUpdates, quoteEventInserts } = sbForSend({ quote: { status: "draft" }, managers: [] });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toEqual({ ok: false, error: "client has no active managers" });
    // The flip + 'sent' event already happened (matches canRetryDelivery's
    // model: a quote can read 'sent' with no confirmed delivery) — that's
    // what lets a later retry, once a manager exists, pick this back up.
    expect(quotesUpdates).toHaveLength(1);
    expect(quoteEventInserts).toHaveLength(1);
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });

  it("leaves the quote sent-but-undelivered when Resend rejects the send, for a later retry to pick up", async () => {
    deliverEmailMock.mockRejectedValueOnce(new Error("Resend send failed (500)"));
    const { sb, quoteEventUpdates } = sbForSend({ quote: { status: "draft" } });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toEqual({ ok: false, error: "Resend send failed (500)" });
    // No resend_message_id write was ever reached — the 'sent' event stays
    // exactly as canRetryDelivery expects: resend_message_id still null.
    expect(quoteEventUpdates).toHaveLength(0);
  });
});

describe("send retry path", () => {
  it("re-attempts delivery without flipping the status again or inserting a second 'sent' event", async () => {
    const { sb, quotesUpdates, quoteEventInserts, quoteEventUpdates } = sbForSend({
      quote: { status: "sent" },
      sentMessageId: null, // confirmed delivery never happened — the retry case
    });
    const res = await makeQuoteService(sb).send("q1", sender);

    expect(res).toEqual({ ok: true, sentTo: ["mgr@acme.co"] });
    expect(quotesUpdates).toHaveLength(0); // status was never re-written
    expect(quoteEventInserts).toHaveLength(0); // no second 'sent' event
    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    expect(quoteEventUpdates).toHaveLength(1);
    expect(quoteEventUpdates[0]).toMatchObject({ resend_message_id: "<mock-id@send.rocking.one>" });
  });

  it("refuses a second delivery once resend_message_id is already recorded (not a retry any more)", async () => {
    const { sb } = sbForSend({ quote: { status: "sent" }, sentMessageId: "<already@send.rocking.one>" });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toEqual({ ok: false, error: 'cannot send a quote in status "sent"' });
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });
});

// ---------- amend() stub ----------

type AmendQuoteRow = { id: string; current_version: number; status: string };

function sbForAmend(opts: {
  quote?: Partial<AmendQuoteRow>;
  versionInsertError?: { message: string } | null;
  internalInsertError?: { message: string } | null;
  quotesUpdateError?: { message: string } | null;
  eventsInsertError?: { message: string } | null;
}) {
  const quote: AmendQuoteRow = { id: "q1", current_version: 1, status: "draft", ...opts.quote };
  const versionInserts: Record<string, unknown>[] = [];
  const internalInserts: Record<string, unknown>[] = [];
  const quotesUpdates: Record<string, unknown>[] = [];
  const eventInserts: Record<string, unknown>[] = [];
  let versionSeq = 0;

  const sb = {
    from: (table: string) => {
      if (table === "quotes") {
        return {
          select: (_cols?: string) => chain(quote),
          update: (row: Record<string, unknown>) => {
            quotesUpdates.push(row);
            return chain(null, opts.quotesUpdateError ?? null);
          },
        };
      }
      if (table === "quote_versions") {
        return {
          insert: (row: Record<string, unknown>) => {
            versionInserts.push(row);
            if (opts.versionInsertError) return chain(null, opts.versionInsertError);
            versionSeq += 1;
            return chain({ id: `v${versionSeq}` });
          },
        };
      }
      if (table === "quote_internal") {
        return {
          insert: (rows: unknown) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            internalInserts.push(...arr);
            return chain(null, opts.internalInsertError ?? null);
          },
        };
      }
      if (table === "quote_events") {
        return {
          insert: (row: Record<string, unknown>) => {
            eventInserts.push(row);
            return chain(null, opts.eventsInsertError ?? null);
          },
        };
      }
      throw new Error(`sbForAmend: unexpected table "${table}"`);
    },
  };
  return { sb: sb as never, quote, versionInserts, internalInserts, quotesUpdates, eventInserts };
}

describe("amend never leaves a quote live", () => {
  it("returns a sent quote to review for a gated caller", async () => {
    const { sb, quotesUpdates } = sbForAmend({ quote: { status: "sent", current_version: 1 } });
    const res = await makeQuoteService(sb).amend("q1", { title: "T", doc: baseDoc() }, gated);
    expect(res).toMatchObject({ ok: true, status: "pending_review", version: 2 });
    expect(quotesUpdates.some((u) => u.status === "sent")).toBe(false);
    expect(quotesUpdates[0]).toMatchObject({ status: "pending_review", current_version: 2 });
  });

  it("returns a sent quote to draft for a caller who CAN send — the back door this design closes", async () => {
    const { sb, quotesUpdates, eventInserts } = sbForAmend({ quote: { status: "sent", current_version: 3 } });
    const res = await makeQuoteService(sb).amend("q1", { title: "T", doc: baseDoc() }, sender);
    expect(res).toMatchObject({ ok: true, status: "draft", version: 4 });
    expect(quotesUpdates.some((u) => u.status === "sent")).toBe(false);
    expect(quotesUpdates[0]).toMatchObject({ status: "draft", current_version: 4 });
    // 'draft' is not a legal quote_events.event (migration 0059's CHECK
    // constraint) — no event row for a draft amend, ever.
    expect(eventInserts).toHaveLength(0);
  });
});

describe("amend validation and totals", () => {
  it("refuses to amend an accepted quote, without writing anything", async () => {
    const { sb, versionInserts } = sbForAmend({ quote: { status: "accepted" } });
    const res = await makeQuoteService(sb).amend("q1", { title: "T", doc: baseDoc() }, gated);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/accepted/i) });
    expect(versionInserts).toHaveLength(0);
  });

  it("returns 'quote not found' for a missing quote", async () => {
    const sb = { from: () => ({ select: () => chain(null) }) } as never;
    const res = await makeQuoteService(sb).amend("missing", { title: "T", doc: baseDoc() }, gated);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/not found/i) });
  });

  it("recomputes totals, carries internal rows, and writes exactly one pending_review event", async () => {
    const { sb, versionInserts, internalInserts, eventInserts } = sbForAmend({
      quote: { status: "pending_review", current_version: 1 },
    });
    const doc = baseDoc();
    const expected = computeTotals(doc);
    const res = await makeQuoteService(sb).amend(
      "q1",
      { title: "Revised VoIP System", doc, internal: [{ path: "s0.g0.i0", supplierCost: 90, note: "revised cost" }] },
      gated,
    );

    expect(res).toMatchObject({ ok: true, status: "pending_review", version: 2 });
    expect(versionInserts).toHaveLength(1);
    expect(versionInserts[0]).toMatchObject({
      version: 2,
      subtotal: expected.subtotal,
      vat_amount: expected.vat,
      grand_total: expected.grand,
      monthly_total: expected.monthly,
    });
    expect(internalInserts).toHaveLength(1);
    expect(internalInserts[0]).toMatchObject({ line_path: "s0.g0.i0", supplier_cost: 90 });

    expect(eventInserts).toHaveLength(1);
    expect(eventInserts[0]).toMatchObject({ event: "pending_review", version: 2, actor_profile_id: null });
  });
});
