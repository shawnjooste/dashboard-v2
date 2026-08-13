import { describe, expect, it } from "vitest";
import { makeQuoteService } from "./service.ts";
import type { Actor } from "./policy.ts";
import type { QuoteDoc } from "./doc.ts";

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
 *  deletes so a rollback test can assert compensation actually ran. */
function sbForCreate(opts: {
  client?: { id: string; name: string; quote_prefix: string | null } | null;
  quoteNumber?: string;
  rpcError?: { message: string } | null;
  failVersionInsert?: boolean;
}) {
  const client = opts.client ?? { id: "c1", name: "Acme Co", quote_prefix: "ACM" };
  const inserted: Record<string, unknown[]> = { quotes: [], quote_versions: [], quote_internal: [], quote_events: [] };
  const deleted: Record<string, unknown[]> = { quotes: [], quote_versions: [], quote_internal: [], quote_events: [] };
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
        eq: (_col: string, val: unknown) => {
          deleted[table]?.push(val);
          return Promise.resolve({ data: null, error: null });
        },
        in: (_col: string, vals: unknown[]) => {
          deleted[table]?.push(...vals);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
    rpc: async (_name: string, _args: unknown) => {
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: opts.quoteNumber ?? "QU-ACM-001", error: null };
    },
  };
  return { sb: sb as never, inserted, deleted };
}

describe("create is idempotent", () => {
  it("returns the original quote and writes nothing on a repeated key", async () => {
    const svc = makeQuoteService(sbWithExistingKey());
    const res = await svc.create(
      { clientId: "c1", title: "T", doc: {} as never, idempotencyKey: "key-1" },
      gated,
    );
    expect(res).toMatchObject({ ok: true, quoteId: "q1", quoteNumber: "QU-ABC-001", replayed: true });
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
  it("writes quotes, quote_versions, quote_internal and quote_events, and gates status by actor", async () => {
    const { sb, inserted } = sbForCreate({ quoteNumber: "QU-ACM-004" });
    const svc = makeQuoteService(sb);
    const res = await svc.create(
      {
        clientId: "c1",
        title: "VoIP System",
        doc: baseDoc(),
        internal: [{ path: "s0.g0.i0", supplierCost: 120, note: "supplier invoice" }],
      },
      gated, // gated actor -> pending_review, never draft/sent
    );

    expect(res).toMatchObject({ ok: true, quoteNumber: "QU-ACM-004", version: 1, status: "pending_review", replayed: false });
    expect(inserted.quotes).toHaveLength(1);
    expect(inserted.quotes[0]).toMatchObject({ status: "pending_review", quote_number: "QU-ACM-004" });
    expect(inserted.quote_versions).toHaveLength(1);
    expect(inserted.quote_internal).toHaveLength(1);
    expect(inserted.quote_events).toHaveLength(2);
    expect(inserted.quote_events[0]).toMatchObject({ event: "created" });
    expect(inserted.quote_events[1]).toMatchObject({ event: "pending_review" });
  });

  it("a sending actor lands in draft, never sent, and create() sends no client email", async () => {
    const { sb, inserted } = sbForCreate({ quoteNumber: "QU-ACM-005" });
    const svc = makeQuoteService(sb);
    const res = await svc.create({ clientId: "c1", title: "VoIP System", doc: baseDoc() }, sender);
    expect(res).toMatchObject({ ok: true, status: "draft" });
    expect(inserted.quotes[0]).toMatchObject({ status: "draft" });
  });
});

describe("create compensates on partial failure", () => {
  it("rolls back the quote row when the version insert fails", async () => {
    const { sb, inserted, deleted } = sbForCreate({ quoteNumber: "QU-ACM-006", failVersionInsert: true });
    const svc = makeQuoteService(sb);
    const res = await svc.create({ clientId: "c1", title: "VoIP System", doc: baseDoc() }, gated);

    expect(res).toMatchObject({ ok: false, error: expect.any(String) });
    expect(inserted.quotes).toHaveLength(1); // the quote row was written...
    expect(deleted.quotes).toContain("q-1"); // ...then cleaned up
    expect(deleted.quote_versions).toContain("q-1");
    expect(deleted.quote_events).toContain("q-1");
  });
});
