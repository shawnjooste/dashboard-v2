import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocked so the email gate can be asserted POSITIVELY (what was actually
// sent), not just inferred from an unset env var. Same resolved module
// lib/quotes/service.ts imports via "../email/deliver.ts" — the "@/..."
// alias and the relative specifier resolve to the same file under vitest
// (see vitest.config.ts), so mocking either intercepts the same import.
vi.mock("@/lib/email/deliver", () => ({
  deliverEmail: vi.fn(async () => ({ id: "mock-id", suppressed: [] })),
}));
import { deliverEmail } from "@/lib/email/deliver";
const deliverEmailMock = vi.mocked(deliverEmail);

// createServiceClient() reads SUPABASE_SERVICE_ROLE_KEY and builds a real
// client — routes must get a stub instead under test.
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
import { createServiceClient } from "@/lib/supabase/service";
const createServiceClientMock = vi.mocked(createServiceClient);

import { hashApiKey } from "@/lib/api/auth";
import { CHECKOUT_PAYMENT_TERM } from "@/lib/quotes/api-template";

/** Converts a Postgres ILIKE pattern (escape char `\`) into an equivalent
 *  case-insensitive RegExp, so the `clients.ilike` stub below actually
 *  exercises wildcard semantics instead of a naive substring check — the
 *  distinction the escapeLike diagnostic tests exist to prove. Unescaped `%`
 *  becomes `.*`, unescaped `_` becomes `.`, and `\%`/`\_`/`\\` become their
 *  literal characters. */
function ilikeToRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      re += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    } else if (c === "%") {
      re += ".*";
    } else if (c === "_") {
      re += ".";
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "i");
}
import { POST } from "@/app/api/v1/quotes/route";
import { GET as GET_QUOTE } from "@/app/api/v1/quotes/[id]/route";
import { POST as POST_AMEND } from "@/app/api/v1/quotes/[id]/amend/route";
import { GET as GET_CLIENTS } from "@/app/api/v1/clients/route";

beforeEach(() => {
  deliverEmailMock.mockClear();
  createServiceClientMock.mockReset();
});

type ApiKeyRow = { id: string; name: string; profile_id: string | null; revoked_at: string | null };
type ClientRow = { id: string; name: string; quote_prefix: string | null };
type CompanyDetailsRow = { registered_name?: string | null; billing_contact_name?: string | null; physical_address?: string | null };
type QuoteRow = {
  id: string;
  quote_number: string;
  status: string;
  current_version: number;
  client_id?: string;
  checkout_enabled?: boolean | null;
};
type VersionRow = { subtotal: number; vat_amount: number; grand_total: number; monthly_total: number | null };

/** House stub: a plain object shaped like the slice of SupabaseClient the
 *  auth module, resolveClient, and the quote service actually call, per
 *  table. Mirrors the pattern in lib/api/auth.test.ts and
 *  lib/quotes/service.create.test.ts. */
function buildSb(opts: {
  apiKey?: { raw: string; row: ApiKeyRow };
  /** Extra keys beyond the singular `apiKey`, for tests that need TWO
   *  distinct, independently-authenticating keys in the same stub (e.g. the
   *  Idempotency-Key namespacing test). */
  apiKeys?: { raw: string; row: ApiKeyRow }[];
  clients?: ClientRow[];
  companyDetails?: Record<string, CompanyDetailsRow>;
  quoteNumber?: string;
  idempotencyExisting?: { key: string; row: { id: string; quote_number: string; current_version: number; status: string } };
  /** Simulates a genuine concurrent-create race on the idempotency unique
   *  index: the FIRST `quotes.insert()` carrying this key returns a raw
   *  23505-shaped error (as if a concurrent caller's insert won the race),
   *  and every idempotency SELECT for this key returns `existingRow` only
   *  AFTER that insert attempt has happened — exactly what the route's
   *  retry-once recovery is supposed to see. */
  idempotencyRace?: { key: string; existingRow: { id: string; quote_number: string; current_version: number; status: string } };
  quotesById?: Record<string, QuoteRow>;
  versions?: Record<string, Record<number, VersionRow>>;
}) {
  const clients = opts.clients ?? [];
  const companyDetails = opts.companyDetails ?? {};
  const quotesById = opts.quotesById ?? {};
  const versions = opts.versions ?? {};
  const apiKeys = [...(opts.apiKey ? [opts.apiKey] : []), ...(opts.apiKeys ?? [])];
  let raceResolved = false;
  const inserted: Record<string, Record<string, unknown>[]> = {
    quotes: [],
    quote_versions: [],
    quote_internal: [],
    quote_events: [],
  };
  // Every payload passed to quotes.update(...), in call order — exposed via
  // the returned stub's `_quotesUpdates` so amend tests can assert POSITIVELY
  // that no update ever writes status:"sent" (amend must never leave a quote
  // live), rather than only inferring it from the response shape.
  const quotesUpdates: Record<string, unknown>[] = [];
  let quoteSeq = 0;
  let versionSeq = 0;

  const sb = {
    from(table: string) {
      if (table === "api_keys") {
        return {
          select: () => ({
            eq: (_c: string, val: string) => ({
              maybeSingle: async () => ({
                data: apiKeys.find((k) => val === hashApiKey(k.raw))?.row ?? null,
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        };
      }
      if (table === "clients") {
        return {
          select: () => ({
            eq: (_c: string, val: string) => ({
              maybeSingle: async () => ({ data: clients.find((c) => c.id === val) ?? null, error: null }),
            }),
            ilike: (_c: string, pattern: string) => {
              const re = ilikeToRegex(pattern);
              const rows = clients.filter((c) => re.test(c.name));
              const result = { data: rows, error: null };
              return {
                ...result,
                order: () => ({ limit: async () => ({ data: rows, error: null }) }),
                limit: async (_n: number) => ({ data: rows, error: null }),
              };
            },
          }),
        };
      }
      if (table === "client_company_details") {
        return {
          select: () => ({
            eq: (_c: string, val: string) => ({
              maybeSingle: async () => ({ data: companyDetails[val] ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === "quotes") {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              maybeSingle: async () => {
                if (col === "idempotency_key") {
                  if (opts.idempotencyRace && val === opts.idempotencyRace.key) {
                    return { data: raceResolved ? opts.idempotencyRace.existingRow : null, error: null };
                  }
                  return {
                    data: opts.idempotencyExisting?.key === val ? opts.idempotencyExisting.row : null,
                    error: null,
                  };
                }
                if (col === "id") return { data: quotesById[val] ?? null, error: null };
                return { data: null, error: null };
              },
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            if (opts.idempotencyRace && row.idempotency_key === opts.idempotencyRace.key && !raceResolved) {
              // The FIRST insert carrying this key loses the simulated race:
              // a concurrent caller's insert is treated as having already
              // landed, so this one hits the unique index.
              raceResolved = true;
              return {
                error: null,
                select: () => ({
                  single: async () => ({
                    data: null,
                    error: { message: 'duplicate key value violates unique constraint "quotes_idempotency_key_idx"' },
                  }),
                }),
              };
            }
            inserted.quotes.push(row);
            return {
              error: null,
              select: () => ({
                single: async () => {
                  quoteSeq += 1;
                  const id = `q-${quoteSeq}`;
                  inserted.quotes[inserted.quotes.length - 1].id = id;
                  return { data: { id }, error: null };
                },
              }),
            };
          },
          update: (patch: Record<string, unknown>) => {
            quotesUpdates.push(patch);
            return { eq: async () => ({ data: null, error: null }) };
          },
        };
      }
      if (table === "quote_versions") {
        return {
          select: () => ({
            eq: (_c1: string, quoteId: string) => ({
              eq: (_c2: string, version: number) => ({
                maybeSingle: async () => ({ data: versions[quoteId]?.[version] ?? null, error: null }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserted.quote_versions.push(row);
            return {
              error: null,
              select: () => ({
                single: async () => {
                  versionSeq += 1;
                  const id = `v-${versionSeq}`;
                  inserted.quote_versions[inserted.quote_versions.length - 1].id = id;
                  return { data: { id }, error: null };
                },
              }),
            };
          },
        };
      }
      if (table === "quote_internal") {
        return {
          insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
            inserted.quote_internal.push(...(Array.isArray(rows) ? rows : [rows]));
            return { error: null };
          },
        };
      }
      if (table === "quote_events") {
        return {
          insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
            inserted.quote_events.push(...(Array.isArray(rows) ? rows : [rows]));
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: async () => ({ data: opts.quoteNumber ?? "QU-TEST-001", error: null }),
    // Debug-only surface, not part of the SupabaseClient shape any route
    // code touches: quotesUpdatesOf()/versionsInsertedOf() below reach through
    // the `never` cast to read these back for assertions.
    _quotesUpdates: quotesUpdates,
    _quoteVersionsInserted: inserted.quote_versions,
  };
  return sb as never;
}

/** Every payload passed to quotes.update(...) against a stub built by
 *  buildSb, in call order. */
function quotesUpdatesOf(sb: unknown): Record<string, unknown>[] {
  return (sb as { _quotesUpdates: Record<string, unknown>[] })._quotesUpdates;
}

/** Every row passed to quote_versions.insert(...) against a stub built by
 *  buildSb, in call order. */
function versionsInsertedOf(sb: unknown): Record<string, unknown>[] {
  return (sb as { _quoteVersionsInserted: Record<string, unknown>[] })._quoteVersionsInserted;
}

function req(path: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  return new Request(`http://localhost${path}`, {
    method: opts.method ?? "GET",
    headers: opts.headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** A fixture API key: raw value + the row `authenticateApiKey` would find by
 *  its hash (see buildSb's api_keys handler), plus the ready-to-use
 *  `Authorization` header. */
function fixtureFor(label: string) {
  const raw = `rq_live_test_${label.toLowerCase()}`;
  const row: ApiKeyRow = { id: `key-${label}`, name: label, profile_id: null, revoked_at: null };
  return { raw, row, header: `Bearer ${raw}` };
}

describe("401 without a key", () => {
  it.each([
    ["POST /api/v1/quotes", () => POST(req("/api/v1/quotes", { method: "POST", body: { title: "T", items: [] } }))],
    ["GET /api/v1/clients", () => GET_CLIENTS(req("/api/v1/clients?search=ab"))],
    ["GET /api/v1/quotes/[id]", () => GET_QUOTE(req("/api/v1/quotes/q1"), { params: Promise.resolve({ id: "q1" }) })],
    [
      "POST /api/v1/quotes/[id]/amend",
      () =>
        POST_AMEND(req("/api/v1/quotes/q1/amend", { method: "POST", body: { title: "T", items: [] } }), {
          params: Promise.resolve({ id: "q1" }),
        }),
    ],
  ])("%s refuses with 401 {error: unauthorized}", async (_label, call) => {
    createServiceClientMock.mockReturnValue(buildSb({}));
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("POST /api/v1/quotes", () => {
  it("create happy path: 201, pending_review, and the staff-only review gate holds", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({
      apiKey: key,
      clients: [{ id: "c-sun", name: "Sun Destinations", quote_prefix: "SUN" }],
      quoteNumber: "QU-SUN-002",
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: key.header, "content-type": "application/json" },
        body: {
          client: "Sun Destinations",
          title: "Windows 11 Pro Licence",
          items: [
            {
              description: "Microsoft Windows 11 Professional — Licence",
              detail: "One licence, supplied with its activation key.",
              qty: 1,
              supplierCostExVat: 2299,
              monthly: false,
            },
          ],
          summaryNote: "Supply of the licence and key only.",
        },
      }),
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({
      quoteNumber: "QU-SUN-002",
      version: 1,
      status: "pending_review",
      replayed: false,
      totals: { exVat: 2643.85, vat: 396.58, inclVat: 3040.43, monthlyInclVat: null },
    });
    expect(typeof json.quoteId).toBe("string");
    expect(json.adminUrl).toContain(`/admin/quotes/${json.quoteId}`);

    // The gate, positively: the review notification went to staff, cc
    // accounts@, marked internal — and NO address outside rocking.one
    // anywhere in the call (never the client).
    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    const [, sentOpts] = deliverEmailMock.mock.calls[0];
    expect(sentOpts.to).toEqual(["shawn@rocking.one", "kelle@rocking.one"]);
    expect(sentOpts.cc).toEqual(["accounts@rocking.one"]);
    expect(sentOpts.audience).toBe("internal");
    const allAddresses = [...sentOpts.to, ...(sentOpts.cc ?? []), ...(sentOpts.bcc ?? [])];
    expect(allAddresses.length).toBeGreaterThan(0);
    for (const addr of allAddresses) {
      expect(addr.toLowerCase().endsWith("@rocking.one")).toBe(true);
    }
  });

  it("ambiguous client name: 409 with candidates", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({
      apiKey: key,
      clients: [
        { id: "c1", name: "Acme Ltd", quote_prefix: "AC1" },
        { id: "c2", name: "Acme Co", quote_prefix: "AC2" },
      ],
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: key.header },
        body: { client: "Acme", title: "T", items: [{ description: "X", qty: 1, unitPriceExVat: 10 }] },
      }),
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("ambiguous");
    expect(json.candidates).toEqual(
      expect.arrayContaining([
        { id: "c1", name: "Acme Ltd" },
        { id: "c2", name: "Acme Co" },
      ]),
    );
  });

  it("unknown client name: 404", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({ apiKey: key, clients: [] });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: key.header },
        body: { client: "Nonexistent Co", title: "T", items: [{ description: "X", qty: 1, unitPriceExVat: 10 }] },
      }),
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("no client matching 'Nonexistent Co'");
  });

  it("client search '%%': ILIKE wildcards are escaped, so resolveClient matches no one rather than every client", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({
      apiKey: key,
      clients: [
        { id: "c1", name: "Sun Destinations", quote_prefix: "SUN" },
        { id: "c2", name: "Acme Co", quote_prefix: "ACM" },
      ],
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: key.header },
        body: { client: "%%", title: "T", items: [{ description: "X", qty: 1, unitPriceExVat: 10 }] },
      }),
    );

    // Zero matches, not "ambiguous" (which is what an unescaped "%%" would
    // produce by matching every client) — a real 404, exactly like any other
    // no-match search.
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("no client matching '%%'");
  });

  it("client with a null quote_prefix: 422, never guesses one", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({
      apiKey: key,
      clients: [{ id: "c1", name: "J2 MSSP", quote_prefix: null }],
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: key.header },
        body: { client: "J2 MSSP", title: "T", items: [{ description: "X", qty: 1, unitPriceExVat: 10 }] },
      }),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain("no quote prefix set");
  });

  it("supplierCostExVat XOR unitPriceExVat violation: 422 with field details", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({
      apiKey: key,
      clients: [{ id: "c1", name: "Acme Co", quote_prefix: "ACM" }],
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: key.header },
        body: {
          client: "Acme Co",
          title: "T",
          items: [{ description: "X", qty: 1, supplierCostExVat: 100, unitPriceExVat: 50 }],
        },
      }),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "items[0].price" })]),
    );
  });

  it("items as a string (structurally alien body): 422 validation failed, never a 500", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({ apiKey: key, clients: [{ id: "c1", name: "Acme Co", quote_prefix: "ACM" }] });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: key.header },
        body: { client: "Acme Co", title: "T", items: "not an array" },
      }),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
    expect(json.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: "items" })]));
  });

  it("a non-object JSON body (null): 422 validation failed, never a 500", async () => {
    const key = fixtureFor("Hermes");
    createServiceClientMock.mockReturnValue(buildSb({ apiKey: key }));

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: key.header, "content-type": "application/json" },
        body: null,
      }),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
  });

  it("Idempotency-Key replay: 200 with replayed:true, the existing quote's true status, and the STORED quote's totals (not the request's)", async () => {
    const key = fixtureFor("Hermes");
    // Namespaced per key — see the two tests below for the reason.
    const namespacedKey = `${key.row.id}:replay-key-1`;
    const sb = buildSb({
      apiKey: key,
      clients: [{ id: "c1", name: "Acme Co", quote_prefix: "ACM" }],
      idempotencyExisting: {
        key: namespacedKey,
        row: { id: "q-9", quote_number: "QU-ACM-009", current_version: 3, status: "sent" },
      },
      // Deliberately different from what the request body below would
      // compute (exVat 10 / vat 1.5 / inclVat 11.5 / no monthly) — a
      // replay must report what the STORED quote actually is, never
      // whatever this particular request's body happens to total.
      versions: { "q-9": { 3: { subtotal: 500, vat_amount: 75, grand_total: 575, monthly_total: 120.5 } } },
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: key.header, "idempotency-key": "replay-key-1" },
        body: { client: "Acme Co", title: "T", items: [{ description: "X", qty: 1, unitPriceExVat: 10 }] },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      replayed: true,
      status: "sent",
      quoteId: "q-9",
      quoteNumber: "QU-ACM-009",
      version: 3,
    });
    // The diagnostic assertion Finding 1 exists to pin: the STORED row's
    // totals, not the request body's.
    expect(json.totals).toEqual({ exVat: 500, vat: 75, inclVat: 575, monthlyInclVat: 120.5 });
    // A replay writes nothing new and sends no notification.
    expect(deliverEmailMock).not.toHaveBeenCalled();
  });

  it("Idempotency-Key is scoped per API key: the same header value from a different key never replays another key's quote", async () => {
    const keyA = fixtureFor("Hermes");
    const keyB = fixtureFor("Kelle");
    const header = "shared-header-value";
    const sb = buildSb({
      apiKeys: [keyA, keyB],
      clients: [{ id: "c1", name: "Acme Co", quote_prefix: "ACM" }],
      // Only key A's namespaced idempotency key resolves to an existing
      // quote. If the route ever used the bare header as the idempotency
      // key, key B's identical header would wrongly replay key A's quote —
      // a cross-client read.
      idempotencyExisting: {
        key: `${keyA.row.id}:${header}`,
        row: { id: "q-A", quote_number: "QU-ACM-201", current_version: 1, status: "pending_review" },
      },
      quoteNumber: "QU-ACM-202",
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: keyB.header, "idempotency-key": header },
        body: { client: "Acme Co", title: "T", items: [{ description: "X", qty: 1, unitPriceExVat: 10 }] },
      }),
    );

    // A fresh 201 create for key B — never a 200 replay of key A's quote.
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.replayed).toBe(false);
    expect(json.quoteId).not.toBe("q-A");
    expect(json.quoteNumber).toBe("QU-ACM-202");
  });

  it("a genuine Idempotency-Key race (two concurrent identical creates) never surfaces a raw Postgres error — the route retries once and returns a clean replay", async () => {
    const key = fixtureFor("Hermes");
    const header = "race-key-1";
    const namespacedKey = `${key.row.id}:${header}`;
    const existingRow = { id: "q-race", quote_number: "QU-ACM-300", current_version: 1, status: "pending_review" };
    const sb = buildSb({
      apiKey: key,
      clients: [{ id: "c1", name: "Acme Co", quote_prefix: "ACM" }],
      idempotencyRace: { key: namespacedKey, existingRow },
      versions: { "q-race": { 1: { subtotal: 500, vat_amount: 75, grand_total: 575, monthly_total: null } } },
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST(
      req("/api/v1/quotes", {
        method: "POST",
        headers: { authorization: key.header, "idempotency-key": header },
        // A different body from whatever "won" the race — proves the
        // response reflects the winner's stored quote, not this request.
        body: { client: "Acme Co", title: "T", items: [{ description: "X", qty: 1, unitPriceExVat: 999 }] },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ replayed: true, quoteId: "q-race", quoteNumber: "QU-ACM-300", version: 1 });
    expect(json.error).toBeUndefined();
    expect(json.totals).toEqual({ exVat: 500, vat: 75, inclVat: 575, monthlyInclVat: null });
  });
});

describe("GET /api/v1/clients", () => {
  it("search shorter than 2 characters: 422", async () => {
    const key = fixtureFor("Hermes");
    createServiceClientMock.mockReturnValue(buildSb({ apiKey: key }));

    const res = await GET_CLIENTS(req("/api/v1/clients?search=a", { headers: { authorization: key.header } }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("happy path: up to 20 matches, {id, name, quotePrefix}", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({
      apiKey: key,
      clients: [{ id: "c1", name: "Sun Destinations", quote_prefix: "SUN" }],
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await GET_CLIENTS(req("/api/v1/clients?search=sun", { headers: { authorization: key.header } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "c1", name: "Sun Destinations", quotePrefix: "SUN" }]);
  });

  it("search '%%': ILIKE wildcards are escaped, so it matches only literal-percent names, never every client", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({
      apiKey: key,
      clients: [
        { id: "c1", name: "Sun Destinations", quote_prefix: "SUN" },
        { id: "c2", name: "Acme Co", quote_prefix: "ACM" },
      ],
    });
    createServiceClientMock.mockReturnValue(sb);

    // "%25%25" is the URL-encoded literal two-character search string "%%".
    // Unescaped, an ILIKE pattern of "%%%%%%" (the search wrapped in its own
    // %-fencing) is just ".*" and matches every client; escaped, it requires
    // a literal "%%" in the name — none of the fixtures have one.
    const res = await GET_CLIENTS(req("/api/v1/clients?search=%25%25", { headers: { authorization: key.header } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /api/v1/quotes/[id]", () => {
  it("unknown id: 404", async () => {
    const key = fixtureFor("Hermes");
    createServiceClientMock.mockReturnValue(buildSb({ apiKey: key }));

    const res = await GET_QUOTE(req("/api/v1/quotes/missing", { headers: { authorization: key.header } }), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBeDefined();
  });

  it("happy shape: quoteNumber, status, version, totals, portalUrl, adminUrl", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({
      apiKey: key,
      quotesById: { "q-1": { id: "q-1", quote_number: "QU-ABC-001", status: "pending_review", current_version: 2 } },
      versions: { "q-1": { 2: { subtotal: 1000, vat_amount: 150, grand_total: 1150, monthly_total: null } } },
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await GET_QUOTE(req("/api/v1/quotes/q-1", { headers: { authorization: key.header } }), {
      params: Promise.resolve({ id: "q-1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      quoteNumber: "QU-ABC-001",
      status: "pending_review",
      version: 2,
      totals: { exVat: 1000, vat: 150, inclVat: 1150, monthlyInclVat: null },
      portalUrl: expect.stringContaining("/quotes/q-1"),
      adminUrl: expect.stringContaining("/admin/quotes/q-1"),
    });
  });
});

describe("POST /api/v1/quotes/[id]/amend", () => {
  it("unknown id: 404", async () => {
    const key = fixtureFor("Hermes");
    createServiceClientMock.mockReturnValue(buildSb({ apiKey: key }));

    const res = await POST_AMEND(
      req("/api/v1/quotes/missing/amend", {
        method: "POST",
        headers: { authorization: key.header },
        body: { title: "T", items: [{ description: "X", qty: 1, unitPriceExVat: 10 }] },
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBeDefined();
  });

  it("amend happy path (draft): version bumped, lands in pending_review because API actors are always gated, reviewers notified", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({
      apiKey: key,
      clients: [{ id: "c-sun", name: "Sun Destinations", quote_prefix: "SUN" }],
      quotesById: {
        "q-1": {
          id: "q-1",
          quote_number: "QU-SUN-002",
          status: "draft", // still in review — the one status range the API may amend
          current_version: 2,
          client_id: "c-sun",
          checkout_enabled: false,
        },
      },
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST_AMEND(
      req("/api/v1/quotes/q-1/amend", {
        method: "POST",
        headers: { authorization: key.header, "content-type": "application/json" },
        body: {
          title: "Windows 11 Pro Licence — corrected quantity",
          items: [
            {
              description: "Microsoft Windows 11 Professional — Licence",
              detail: "One licence, supplied with its activation key.",
              qty: 1,
              supplierCostExVat: 2299,
              monthly: false,
            },
          ],
          summaryNote: "Supply of the licence and key only.",
        },
      }),
      { params: Promise.resolve({ id: "q-1" }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      quoteId: "q-1",
      quoteNumber: "QU-SUN-002",
      version: 3,
      status: "pending_review",
      totals: { exVat: 2643.85, vat: 396.58, inclVat: 3040.43, monthlyInclVat: null },
    });
    expect(json.adminUrl).toContain("/admin/quotes/q-1");

    // The core guarantee this route exists for, asserted positively against
    // every write the stub recorded — not just the response's own claim:
    // no update to `quotes` ever set status:"sent".
    const updates = quotesUpdatesOf(sb);
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      expect(u.status).not.toBe("sent");
    }
    expect(updates.some((u) => u.status === "pending_review" && u.current_version === 3)).toBe(true);

    // Same positive email gate create()'s happy path asserts: the review
    // notification went to staff only, cc accounts@, marked internal, and no
    // address outside rocking.one anywhere in the call.
    expect(deliverEmailMock).toHaveBeenCalledTimes(1);
    const [, sentOpts] = deliverEmailMock.mock.calls[0];
    expect(sentOpts.to).toEqual(["shawn@rocking.one", "kelle@rocking.one"]);
    expect(sentOpts.cc).toEqual(["accounts@rocking.one"]);
    expect(sentOpts.audience).toBe("internal");
    const allAddresses = [...sentOpts.to, ...(sentOpts.cc ?? []), ...(sentOpts.bcc ?? [])];
    expect(allAddresses.length).toBeGreaterThan(0);
    for (const addr of allAddresses) {
      expect(addr.toLowerCase().endsWith("@rocking.one")).toBe(true);
    }
  });

  it("amend of a checkout quote keeps CHECKOUT_PAYMENT_TERM in the assembled doc", async () => {
    const key = fixtureFor("Hermes");
    const sb = buildSb({
      apiKey: key,
      clients: [{ id: "c-sun", name: "Sun Destinations", quote_prefix: "SUN" }],
      quotesById: {
        "q-2": {
          id: "q-2",
          quote_number: "QU-SUN-003",
          status: "pending_review",
          current_version: 1,
          client_id: "c-sun",
          checkout_enabled: true,
        },
      },
    });
    createServiceClientMock.mockReturnValue(sb);

    const res = await POST_AMEND(
      req("/api/v1/quotes/q-2/amend", {
        method: "POST",
        headers: { authorization: key.header },
        body: { title: "T", items: [{ description: "X", qty: 1, unitPriceExVat: 10 }] },
      }),
      { params: Promise.resolve({ id: "q-2" }) },
    );

    expect(res.status).toBe(200);
    const versions = versionsInsertedOf(sb);
    expect(versions).toHaveLength(1);
    const doc = versions[0].doc as { terms: string[] };
    expect(doc.terms).toContain(CHECKOUT_PAYMENT_TERM);
  });

  describe("amend refuses outside draft/pending_review — the API can only touch quotes still in review", () => {
    it.each(["sent", "accepted", "rejected", "changes_requested", "expired"] as const)(
      "status %s: 409, the service is never called, no email is sent",
      async (status) => {
        const key = fixtureFor("Hermes");
        const sb = buildSb({
          apiKey: key,
          clients: [{ id: "c-sun", name: "Sun Destinations", quote_prefix: "SUN" }],
          quotesById: {
            "q-x": {
              id: "q-x",
              quote_number: "QU-SUN-900",
              status,
              current_version: 1,
              client_id: "c-sun",
              checkout_enabled: false,
            },
          },
        });
        createServiceClientMock.mockReturnValue(sb);

        const res = await POST_AMEND(
          req("/api/v1/quotes/q-x/amend", {
            method: "POST",
            headers: { authorization: key.header },
            body: { title: "T", items: [{ description: "X", qty: 1, unitPriceExVat: 10 }] },
          }),
          { params: Promise.resolve({ id: "q-x" }) },
        );

        expect(res.status).toBe(409);
        const json = await res.json();
        expect(json.error).toBe(
          `this quote is in status "${status}" — the API can only amend quotes still in review; changes to live quotes go through Shawn`,
        );
        // Never reached the service: no new version, no notification.
        expect(versionsInsertedOf(sb)).toHaveLength(0);
        expect(deliverEmailMock).not.toHaveBeenCalled();
      },
    );
  });
});
