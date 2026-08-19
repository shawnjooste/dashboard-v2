import { describe, expect, it, vi } from "vitest";
import { authenticateApiKey, hashApiKey } from "./auth.ts";

// House stub pattern from lib/quotes/service.create.test.ts: a plain object
// shaped like the slice of SupabaseClient this module actually calls.
// `fromSpy` lets malformed-header tests assert no db call was ever made.
type KeyRow = { id: string; name: string; profile_id: string | null; revoked_at: string | null };

function sbWithKeyRow(row: KeyRow | null, opts: { updateRejects?: boolean } = {}) {
  const fromSpy = vi.fn((table: string) => {
    if (table !== "api_keys") throw new Error(`unexpected table: ${table}`);
    return {
      select: (_cols?: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
      update: (_vals: unknown) => ({
        eq: async (_col: string, _val: string) => {
          if (opts.updateRejects) throw new Error("update boom");
          return { data: null, error: null };
        },
      }),
    };
  });
  return { from: fromSpy } as never;
}

describe("hashApiKey", () => {
  it("is a deterministic 64-char hex digest", () => {
    const raw = "rq_live_test0000deadbeef";
    const h1 = hashApiKey(raw);
    const h2 = hashApiKey(raw);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different inputs", () => {
    expect(hashApiKey("rq_live_test0000aaaa")).not.toBe(hashApiKey("rq_live_test0000bbbb"));
  });

  // Known-vector pin: `node -e 'console.log(require("crypto").createHash("sha256").update("rq_live_test").digest("hex"))'`
  // computed once, hardcoded here — a change to hashApiKey's algorithm
  // (hash function, encoding, or what's fed into it) must fail this test
  // loudly, not just the round-trip tests above (which would still pass
  // against a changed-but-still-deterministic implementation).
  it("hashApiKey('rq_live_test') matches the pinned sha256 hex vector", () => {
    expect(hashApiKey("rq_live_test")).toBe(
      "eaad8e802035d0364895858767d3b0b767044405c5879b78c1733f866faeb14d",
    );
  });
});

describe("authenticateApiKey", () => {
  it("maps a valid key to a gated actor, with the row's profile_id and name", async () => {
    const sb = sbWithKeyRow({ id: "key-1", name: "Kelle", profile_id: "p-kelle", revoked_at: null });
    const res = await authenticateApiKey(sb, "Bearer rq_live_test0000validvalidvalid");
    expect(res).toEqual({
      ok: true,
      actor: { id: "p-kelle", label: "Kelle", canSend: false },
      keyId: "key-1",
    });
  });

  it("maps a valid key with no profile (a null id, label carries identity)", async () => {
    const sb = sbWithKeyRow({ id: "key-2", name: "Hermes", profile_id: null, revoked_at: null });
    const res = await authenticateApiKey(sb, "Bearer rq_live_test0000hermeshermes");
    expect(res).toEqual({
      ok: true,
      actor: { id: null, label: "Hermes", canSend: false },
      keyId: "key-2",
    });
  });

  it("refuses a revoked key exactly like an unknown one", async () => {
    const revokedSb = sbWithKeyRow({
      id: "key-3",
      name: "Kelle",
      profile_id: "p-kelle",
      revoked_at: "2026-08-01T00:00:00.000Z",
    });
    const unknownSb = sbWithKeyRow(null);

    const revokedRes = await authenticateApiKey(revokedSb, "Bearer rq_live_test0000revokedrevoked");
    const unknownRes = await authenticateApiKey(unknownSb, "Bearer rq_live_test0000unknownunknown");

    expect(revokedRes).toEqual({ ok: false });
    expect(unknownRes).toEqual({ ok: false });
    expect(revokedRes).toEqual(unknownRes);
  });

  it.each([
    ["null header", null],
    ["bare scheme, no token", "Bearer"],
    ["bearer with a non-rq_live_ token", "Bearer sometoken"],
    ["raw key with no Bearer scheme", "rq_live_test0000noprefixnoprefix"],
    ["empty string", ""],
  ])("refuses a malformed header (%s) without ever touching the db", async (_label, header) => {
    const sb = sbWithKeyRow({ id: "key-4", name: "Kelle", profile_id: "p-kelle", revoked_at: null });
    const res = await authenticateApiKey(sb, header);
    expect(res).toEqual({ ok: false });
    expect((sb as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });

  it("accepts a lowercase 'bearer' scheme — the scheme keyword is case-insensitive", async () => {
    const sb = sbWithKeyRow({ id: "key-6", name: "Kelle", profile_id: "p-kelle", revoked_at: null });
    const res = await authenticateApiKey(sb, "bearer rq_live_test0000lowercaselowercase");
    expect(res).toEqual({
      ok: true,
      actor: { id: "p-kelle", label: "Kelle", canSend: false },
      keyId: "key-6",
    });
  });

  it("accepts a mixed-case 'BeArEr' scheme too", async () => {
    const sb = sbWithKeyRow({ id: "key-7", name: "Kelle", profile_id: "p-kelle", revoked_at: null });
    const res = await authenticateApiKey(sb, "BeArEr rq_live_test0000mixedcasemixedcase");
    expect(res.ok).toBe(true);
  });

  it("still returns ok:true when the fire-and-forget last_used_at update fails", async () => {
    const sb = sbWithKeyRow(
      { id: "key-5", name: "Kelle", profile_id: "p-kelle", revoked_at: null },
      { updateRejects: true },
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await authenticateApiKey(sb, "Bearer rq_live_test0000updatefailsupdatefails");
    expect(res).toEqual({
      ok: true,
      actor: { id: "p-kelle", label: "Kelle", canSend: false },
      keyId: "key-5",
    });
    // Let the fire-and-forget rejection's microtask settle before checking
    // it was caught, not left to become an unhandled rejection.
    await new Promise((r) => setTimeout(r, 0));
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
