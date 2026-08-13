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
 *  call shapes (`.eq()`/`.is()`/`.lt()`/`.limit()` any number of times, in
 *  any order, `.select()`, `.maybeSingle()`, `.single()`) returns either the
 *  same chain (so calls compose freely) or the terminal `{ data, error }` —
 *  and the chain object itself carries `data`/`error` as own properties, so
 *  `await`-ing it directly (without an explicit terminal call) also resolves
 *  correctly, matching how Supabase's query builder is itself a thenable. */
function chain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = { data, error };
  c.eq = () => c;
  c.is = () => c;
  c.lt = () => c;
  c.limit = () => c;
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
 *  atomic status flip), quote_events (messageId lookup, the isRevision
 *  lookup, the 'sent' insert-with-claim, the claim/finalize/release
 *  updates), profiles (active managers), and quote_versions (totals for the
 *  client email). ensureQuoteBookingLink is exercised for real (not mocked)
 *  — with CALENDLY_API_TOKEN_SHAWN unset in the test environment it no-ops
 *  (console.warn + returns null) rather than reaching the network, and its
 *  one query is against the same "quotes" table, satisfied by the same stub.
 *
 *  resend_message_id is modelled as REAL mutable state (not a static
 *  boolean) specifically so two send() calls sharing one `sb` can race over
 *  it the way two overlapping requests would race over the same database
 *  row — that's what makes the concurrency test below meaningful rather
 *  than assuming its own conclusion. */
function sbForSend(opts: {
  quote?: Partial<SendQuoteRow>;
  /** Initial resend_message_id on the 'sent' quote_events row; undefined
   *  means no such row exists yet (a first send). */
  sentMessageId?: string | null;
  /** Whether a 'sent' event exists for some version below current_version —
   *  drives isRevision. */
  hasPriorSentVersion?: boolean;
  managers?: string[];
  versionTotals?: { grand_total: number | null; monthly_total: number | null };
  flipSucceeds?: boolean;
  eventInsertError?: { message: string } | null;
  /** Simulates the finalize UPDATE (writing the real message id) failing —
   *  Resend already delivered the mail; only the bookkeeping write fails.
   *  Applies to the first non-claim quote_events update in the call. */
  finalizeError?: { message: string } | null;
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

  // Mutable shared state for the 'sent' event's resend_message_id — see the
  // doc comment above for why this needs to be real state, not a flag.
  let sentEventExists = opts.sentMessageId !== undefined;
  let currentMessageId: string | null = opts.sentMessageId === undefined ? null : opts.sentMessageId;
  let eventsSelectCount = 0;
  let nonClaimUpdateCount = 0;

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
          // send() issues exactly two selects against quote_events per call,
          // always in this order: (1) the current version's messageId,
          // (2) whether any EARLIER version was ever sent (isRevision). The
          // %2 keeps that alternation correct across however many send()
          // calls share this stub.
          select: (_cols?: string) => {
            eventsSelectCount += 1;
            if (eventsSelectCount % 2 === 1) {
              return chain(sentEventExists ? { resend_message_id: currentMessageId } : null);
            }
            return chain(opts.hasPriorSentVersion ? { version: 1 } : null);
          },
          insert: (row: Record<string, unknown>) => {
            quoteEventInserts.push(row);
            if (opts.eventInsertError) return chain(null, opts.eventInsertError);
            sentEventExists = true;
            currentMessageId = (row.resend_message_id as string | null | undefined) ?? null;
            return chain(null);
          },
          update: (row: Record<string, unknown>) => {
            quoteEventUpdates.push(row);
            const value = (row.resend_message_id as string | null | undefined) ?? null;
            const isClaimAttempt = typeof value === "string" && value.startsWith("claiming:");
            if (isClaimAttempt) {
              // The retry CAS: only succeeds while nobody else holds a claim.
              if (currentMessageId !== null) return chain(null); // lost the race
              currentMessageId = value;
              return chain({ id: "e1" });
            }
            // A finalize (real id or null) or a release (null) write.
            nonClaimUpdateCount += 1;
            if (nonClaimUpdateCount === 1 && opts.finalizeError) {
              return chain(null, opts.finalizeError); // the write itself failed — value NOT applied
            }
            currentMessageId = value;
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
    // The insert itself carries the claim — a non-null placeholder from the
    // very first moment the event exists, so no concurrent caller can ever
    // observe it as an unclaimed (null) retryable row.
    expect(quoteEventInserts[0].resend_message_id).toMatch(/^claiming:/);

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

    // Exactly one non-claim update: the finalize write with the real id.
    expect(quoteEventUpdates).toHaveLength(1);
    expect(quoteEventUpdates[0]).toMatchObject({ resend_message_id: "<mock-id@send.rocking.one>" });
  });

  it("refuses to send from a status the client has already acted on", async () => {
    const { sb } = sbForSend({ quote: { status: "accepted" }, sentMessageId: null });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toEqual({ ok: false, error: 'cannot send a quote in status "accepted"' });
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });

  it("refuses when the flip loses a race (someone else sent it first), with wording that also fits a concurrent amend", async () => {
    const { sb, quoteEventInserts } = sbForSend({ quote: { status: "pending_review" }, flipSucceeds: false });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toEqual({ ok: false, error: "this quote's status changed before it could be sent" });
    expect(quoteEventInserts).toHaveLength(0);
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });

  it("refuses when the client has no active managers, releasing the claim so the quote stays retryable", async () => {
    const { sb, quotesUpdates, quoteEventInserts, quoteEventUpdates } = sbForSend({
      quote: { status: "draft" },
      managers: [],
    });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toEqual({ ok: false, error: "client has no active managers" });
    // The flip + claimed 'sent' event already happened...
    expect(quotesUpdates).toHaveLength(1);
    expect(quoteEventInserts).toHaveLength(1);
    // ...but the claim is released back to null, so a later retry (once a
    // manager exists) is not permanently blocked.
    expect(quoteEventUpdates).toHaveLength(1);
    expect(quoteEventUpdates[0]).toMatchObject({ resend_message_id: null });
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });

  it("releases the claim when Resend rejects the send, for a later retry to pick up", async () => {
    deliverEmailMock.mockRejectedValueOnce(new Error("Resend send failed (500)"));
    const { sb, quoteEventUpdates } = sbForSend({ quote: { status: "draft" } });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toEqual({ ok: false, error: "Resend send failed (500)" });
    // The claim (from the insert) is explicitly released to null — the
    // 'sent' event now reads exactly as canRetryDelivery expects.
    expect(quoteEventUpdates).toHaveLength(1);
    expect(quoteEventUpdates[0]).toMatchObject({ resend_message_id: null });
  });
});

describe("send: unrecorded delivery raises an alert (Resend succeeded, bookkeeping failed)", () => {
  it("stays ok:true, reverts the claim so the quote stays retryable, and alerts staff", async () => {
    const { sb, quoteEventUpdates } = sbForSend({
      quote: { status: "draft" },
      finalizeError: { message: "db down" },
    });
    const res = await makeQuoteService(sb).send("q1", sender);

    expect(res).toMatchObject({ ok: true }); // never turn a successful send into a failure
    // Two deliverEmail calls: the client's quote, then the internal alert.
    expect(deliverEmailMock).toHaveBeenCalledTimes(2);
    expect(deliverEmailMock).toHaveBeenNthCalledWith(
      2,
      sb,
      expect.objectContaining({
        to: ["shawn@rocking.one"],
        cc: ["accounts@rocking.one"],
        audience: "internal",
        category: "quote",
        subject: expect.stringContaining("double-send"),
      }),
    );
    // Reverted to null (the accepted design) — a human is alerted rather
    // than the quote being silently stuck.
    expect(quoteEventUpdates.at(-1)).toMatchObject({ resend_message_id: null });
  });

  it("still returns ok:true even if the alert itself fails to send", async () => {
    deliverEmailMock
      .mockImplementationOnce(async () => ({ id: "mock-id", suppressed: [] })) // client email
      .mockRejectedValueOnce(new Error("alert send failed")); // internal alert
    const { sb } = sbForSend({ quote: { status: "draft" }, finalizeError: { message: "db down" } });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toMatchObject({ ok: true });
  });
});

describe("send: isRevision reflects what the client has actually seen", () => {
  it("does not call a first-time send of a twice-amended draft a revision", async () => {
    const { sb } = sbForSend({
      quote: { status: "draft", current_version: 3 }, // amended twice before ever being sent
      hasPriorSentVersion: false, // nobody outside Rocking has ever seen this quote
    });
    await makeQuoteService(sb).send("q1", sender);
    expect(deliverEmailMock).toHaveBeenCalledWith(
      sb,
      expect.objectContaining({ subject: expect.stringContaining("New quote from Rocking") }),
    );
  });

  it("calls it a revision only once a prior version was actually sent", async () => {
    const { sb } = sbForSend({
      quote: { status: "draft", current_version: 3 },
      hasPriorSentVersion: true,
    });
    await makeQuoteService(sb).send("q1", sender);
    expect(deliverEmailMock).toHaveBeenCalledWith(
      sb,
      expect.objectContaining({ subject: expect.stringContaining("Updated quote from Rocking") }),
    );
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
    // Two updates: the claim CAS, then the finalize write.
    expect(quoteEventUpdates).toHaveLength(2);
    expect(quoteEventUpdates[0].resend_message_id).toMatch(/^claiming:/);
    expect(quoteEventUpdates[1]).toMatchObject({ resend_message_id: "<mock-id@send.rocking.one>" });
  });

  it("refuses a second delivery once resend_message_id is already recorded (not a retry any more)", async () => {
    const { sb } = sbForSend({ quote: { status: "sent" }, sentMessageId: "<already@send.rocking.one>" });
    const res = await makeQuoteService(sb).send("q1", sender);
    expect(res).toEqual({ ok: false, error: 'cannot send a quote in status "sent"' });
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });
});

describe("send concurrency", () => {
  it("two concurrent retries result in at most one deliverEmail call", async () => {
    const { sb, quoteEventUpdates } = sbForSend({
      quote: { status: "sent" },
      sentMessageId: null, // unconfirmed delivery — both calls see the retry case
    });
    const svc = makeQuoteService(sb);
    const results = await Promise.all([svc.send("q1", sender), svc.send("q1", sender)]);

    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: "this quote is already being sent" });
    // The winner's claim was confirmed with the real message id — the loser
    // never touched resend_message_id at all.
    expect(quoteEventUpdates.some((u) => u.resend_message_id === "<mock-id@send.rocking.one>")).toBe(true);
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
