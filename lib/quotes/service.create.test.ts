import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeQuoteService } from "./service.ts";
import type { Actor } from "./policy.ts";
import { computeTotals, type QuoteDoc } from "./doc.ts";

// Mocked so we can assert POSITIVELY on what create() sends, rather than
// relying on RESEND_API_KEY being unset in the test environment (which makes
// deliverEmail a silent no-op and would let a wrong `to`/`audience` pass
// unnoticed). Same relative path service.ts itself imports, since both files
// live in lib/quotes/.
vi.mock("../email/deliver.ts", () => ({
  deliverEmail: vi.fn(async () => ({ id: "mock-id", suppressed: [] })),
}));
import { deliverEmail } from "../email/deliver.ts";
const deliverEmailMock = vi.mocked(deliverEmail);

beforeEach(() => {
  deliverEmailMock.mockClear();
});

const gated: Actor = { id: null, label: "Hermes", canSend: false };
const sender: Actor = { id: "p1", label: "shawn@rocking.one", canSend: true };

/** Minimal stub: a quote already exists carrying the idempotency key. */
function sbWithExistingKey() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "quotes"
              ? { data: { id: "q1", quote_number: "QU-ABC-001", current_version: 1, status: "pending_review" } }
              : { data: null },
        }),
      }),
    }),
  } as never;
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

/** A stub covering the client lookup only — enough to exercise validation
 *  refusals that never reach the RPC / insert chain. */
function sbForValidation(client: { id: string; name: string; quote_prefix: string | null } | null) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (table === "clients" ? { data: client } : { data: null }),
        }),
      }),
    }),
  } as never;
}

/** A fuller stub that models the full write chain create() exercises on the
 *  happy path: client lookup, next_quote_number RPC, and inserts into
 *  quotes / quote_versions / quote_internal / quote_events. Also tracks
 *  deletes (with call ORDER, not just membership) so rollback tests can
 *  assert compensation actually ran child-before-parent. */
function sbForCreate(opts: {
  client?: { id: string; name: string; quote_prefix: string | null } | null;
  quoteNumber?: string;
  rpcError?: { message: string } | null;
  failVersionInsert?: boolean;
  failEventsInsert?: boolean;
  /** Makes delete().eq()/.in() throw for this one table, to prove compensate()
   *  survives a delete failure instead of propagating it out of create(). */
  failDeleteTable?: string;
}) {
  const client = opts.client ?? { id: "c1", name: "Acme Co", quote_prefix: "ACM" };
  const inserted: Record<string, unknown[]> = { quotes: [], quote_versions: [], quote_internal: [], quote_events: [] };
  const deleted: Record<string, unknown[]> = { quotes: [], quote_versions: [], quote_internal: [], quote_events: [] };
  const deleteOrder: string[] = [];
  let quoteSeq = 0;
  let versionSeq = 0;

  const sb = {
    from: (table: string) => ({
      select: (_cols?: string) => ({
        eq: (_col: string, _val?: unknown) => {
          // Used two ways in the implementation:
          //  - clients / idempotency lookups: .eq().maybeSingle()
          //  - compensate()'s quote_versions lookup: awaited directly (a list)
          const listResult = {
            data: table === "quote_versions" ? inserted.quote_versions.map((v) => ({ id: (v as { id?: string }).id })) : [],
            error: null,
          };
          return {
            ...listResult,
            maybeSingle: async () => {
              if (table === "clients") return { data: client };
              if (table === "quotes") return { data: null }; // no idempotency key in these tests
              return { data: null };
            },
          };
        },
      }),
      insert: (rows: unknown) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        // A failed insert never lands a row — mirrors a real DB rejection.
        if (table === "quote_versions" && opts.failVersionInsert) {
          return {
            error: { message: "boom" },
            select: () => ({ single: async () => ({ data: null, error: { message: "boom" } }) }),
          };
        }
        if (table === "quote_events" && opts.failEventsInsert) {
          return { error: { message: "boom" } };
        }
        inserted[table]?.push(...arr);
        return {
          error: null,
          select: (_cols?: string) => ({
            single: async () => {
              if (table === "quotes") {
                quoteSeq += 1;
                const id = `q-${quoteSeq}`;
                (inserted.quotes[inserted.quotes.length - 1] as { id?: string }).id = id;
                return { data: { id }, error: null };
              }
              if (table === "quote_versions") {
                versionSeq += 1;
                const id = `v-${versionSeq}`;
                (inserted.quote_versions[inserted.quote_versions.length - 1] as { id?: string }).id = id;
                return { data: { id }, error: null };
              }
              return { data: null, error: null };
            },
          }),
        };
      },
      delete: () => ({
        eq: async (_col: string, val: unknown) => {
          if (opts.failDeleteTable === table) throw new Error(`compensate boom on ${table}`);
          deleted[table]?.push(val);
          deleteOrder.push(table);
          return { data: null, error: null };
        },
        in: async (_col: string, vals: unknown[]) => {
          if (opts.failDeleteTable === table) throw new Error(`compensate boom on ${table}`);
          deleted[table]?.push(...vals);
          deleteOrder.push(table);
          return { data: null, error: null };
        },
      }),
    }),
    rpc: async (_name: string, _args: unknown) => {
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: opts.quoteNumber ?? "QU-ACM-001", error: null };
    },
  };
  return { sb: sb as never, inserted, deleted, deleteOrder };
}

describe("create is idempotent", () => {
  it("returns the original quote and writes nothing on a repeated key", async () => {
    const svc = makeQuoteService(sbWithExistingKey());
    const res = await svc.create(
      { clientId: "c1", title: "T", doc: {} as never, idempotencyKey: "key-1" },
      gated,
    );
    expect(res).toMatchObject({ ok: true, replayed: true, quoteId: "q1", quoteNumber: "QU-ABC-001", status: "pending_review" });
  });

  it("reports the replayed quote's true status even if it has moved past draft/pending_review", async () => {
    const sb = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === "quotes"
                ? { data: { id: "q2", quote_number: "QU-ABC-002", current_version: 2, status: "sent" } }
                : { data: null },
          }),
        }),
      }),
    } as never;
    const svc = makeQuoteService(sb);
    const res = await svc.create({ clientId: "c1", title: "T", doc: {} as never, idempotencyKey: "key-2" }, gated);
    expect(res).toMatchObject({ ok: true, replayed: true, status: "sent" });
  });
});

describe("create validation refusals", () => {
  it("refuses when the client does not exist", async () => {
    const svc = makeQuoteService(sbForValidation(null));
    const res = await svc.create({ clientId: "missing", title: "T", doc: baseDoc() }, gated);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/client/i) });
  });

  it("refuses a quote with no priced line items", async () => {
    const svc = makeQuoteService(sbForValidation({ id: "c1", name: "Acme Co", quote_prefix: "ACM" }));
    const emptyDoc = baseDoc({
      sections: [{ id: "once-off", title: "Once-off", totalLabel: "Total", groups: [{ name: "Items", items: [] }] }],
    });
    const res = await svc.create({ clientId: "c1", title: "T", doc: emptyDoc }, gated);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/priced|line/i) });
  });

  it("refuses a client with no quote prefix set, rather than guessing one", async () => {
    const svc = makeQuoteService(sbForValidation({ id: "c1", name: "J2 MSSP", quote_prefix: null }));
    const res = await svc.create({ clientId: "c1", title: "T", doc: baseDoc() }, gated);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/prefix/i) });
  });

  it("refuses a validUntil date in the past", async () => {
    const svc = makeQuoteService(sbForValidation({ id: "c1", name: "Acme Co", quote_prefix: "ACM" }));
    const res = await svc.create({ clientId: "c1", title: "T", doc: baseDoc(), validUntil: "2000-01-01" }, gated);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/past/i) });
  });
});

describe("create happy path", () => {
  it("writes quotes, quote_versions (with correct totals), quote_internal, one quote_events row per state, and notifies staff only", async () => {
    const { sb, inserted } = sbForCreate({ quoteNumber: "QU-ACM-004" });
    const svc = makeQuoteService(sb);
    const doc = baseDoc();
    const expectedTotals = computeTotals(doc);
    const res = await svc.create(
      {
        clientId: "c1",
        title: "VoIP System",
        doc,
        internal: [{ path: "s0.g0.i0", supplierCost: 120, note: "supplier invoice" }],
      },
      gated, // gated actor -> pending_review, never draft/sent
    );

    expect(res).toMatchObject({ ok: true, replayed: false, quoteNumber: "QU-ACM-004", version: 1, status: "pending_review" });
    expect(inserted.quotes).toHaveLength(1);
    expect(inserted.quotes[0]).toMatchObject({ status: "pending_review", quote_number: "QU-ACM-004" });

    expect(inserted.quote_versions).toHaveLength(1);
    expect(inserted.quote_versions[0]).toMatchObject({
      subtotal: expectedTotals.subtotal,
      vat_amount: expectedTotals.vat,
      grand_total: expectedTotals.grand,
      monthly_total: expectedTotals.monthly,
    });

    expect(inserted.quote_internal).toHaveLength(1);

    // 'created', then the status event — but 'draft' is never a valid
    // quote_events.event (CHECK constraint, migration 0059), so only
    // pending_review/sent/etc. get a second row.
    expect(inserted.quote_events).toHaveLength(2);
    expect(inserted.quote_events[0]).toMatchObject({ event: "created" });
    expect(inserted.quote_events[1]).toMatchObject({ event: "pending_review" });

    // The single most important assertion in this task: staff-only,
    // never the client.
    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    expect(deliverEmailMock).toHaveBeenCalledWith(
      sb,
      expect.objectContaining({
        to: ["shawn@rocking.one", "kelle@rocking.one"],
        cc: ["accounts@rocking.one"],
        audience: "internal",
        category: "quote",
      }),
    );
  });

  it("a sending actor lands in draft, never sent, writes only a 'created' event, and create() sends no email at all", async () => {
    const { sb, inserted } = sbForCreate({ quoteNumber: "QU-ACM-005" });
    const svc = makeQuoteService(sb);
    const res = await svc.create({ clientId: "c1", title: "VoIP System", doc: baseDoc() }, sender);

    expect(res).toMatchObject({ ok: true, replayed: false, status: "draft" });
    expect(inserted.quotes[0]).toMatchObject({ status: "draft" });

    // Only 'created' — a 'draft' event would violate quote_events' CHECK
    // constraint, so create() must not attempt to write one.
    expect(inserted.quote_events).toHaveLength(1);
    expect(inserted.quote_events[0]).toMatchObject({ event: "created" });

    expect(deliverEmailMock).not.toHaveBeenCalled();
  });
});

describe("create compensates on partial failure", () => {
  it("rolls back the quote row, in order, when the version insert fails", async () => {
    const { sb, inserted, deleted, deleteOrder } = sbForCreate({ quoteNumber: "QU-ACM-006", failVersionInsert: true });
    const svc = makeQuoteService(sb);
    const res = await svc.create({ clientId: "c1", title: "VoIP System", doc: baseDoc() }, gated);

    expect(res).toMatchObject({ ok: false, error: expect.any(String) });
    expect(inserted.quotes).toHaveLength(1); // the quote row was written...
    expect(deleted.quotes).toContain("q-1"); // ...then cleaned up
    expect(deleted.quote_versions).toContain("q-1");
    expect(deleted.quote_events).toContain("q-1");
    // No version ever existed, so there's nothing in quote_internal to clean.
    expect(deleted.quote_internal).toHaveLength(0);
    expect(deleteOrder).toEqual(["quote_events", "quote_versions", "quotes"]);
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });

  it("rolls back quote_internal too, in child-before-parent order, when a later step fails", async () => {
    const { sb, inserted, deleted, deleteOrder } = sbForCreate({ quoteNumber: "QU-ACM-007", failEventsInsert: true });
    const svc = makeQuoteService(sb);
    const res = await svc.create(
      {
        clientId: "c1",
        title: "VoIP System",
        doc: baseDoc(),
        internal: [{ path: "s0.g0.i0", supplierCost: 120, note: "supplier invoice" }],
      },
      gated,
    );

    expect(res).toMatchObject({ ok: false, error: expect.any(String) });
    expect(inserted.quote_versions).toHaveLength(1);
    expect(inserted.quote_internal).toHaveLength(1); // it did exist this time...
    expect(deleted.quote_internal).toContain("v-1"); // ...and got cleaned up first
    expect(deleteOrder).toEqual(["quote_internal", "quote_events", "quote_versions", "quotes"]);
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });

  it("survives a delete itself failing — cleanup still runs to completion and create() still returns ok:false", async () => {
    const { sb, deleteOrder } = sbForCreate({
      quoteNumber: "QU-ACM-008",
      failVersionInsert: true,
      failDeleteTable: "quote_events",
    });
    const svc = makeQuoteService(sb);
    const res = await svc.create({ clientId: "c1", title: "VoIP System", doc: baseDoc() }, gated);

    expect(res).toMatchObject({ ok: false, error: expect.any(String) });
    // quote_events' delete threw, but the remaining deletes still ran —
    // compensate() must not let one failure abort the rest.
    expect(deleteOrder).toEqual(["quote_versions", "quotes"]);
  });
});
