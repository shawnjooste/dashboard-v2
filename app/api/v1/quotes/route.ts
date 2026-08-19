// POST /api/v1/quotes — create a quote via the scoped key API. Thin by
// design: every quote rule (markup, sections, XOR validation, status,
// notification) lives in lib/quotes/api-input.ts and lib/quotes/service.ts.
// This route only does auth, client resolution, JSON in/out, and status
// codes.
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateApiKey } from "@/lib/api/auth";
import { assembleCreate, escapeLike, round2, type ApiCreateBody, type ClientContext } from "@/lib/quotes/api-input";
import { makeQuoteService } from "@/lib/quotes/service";
import { computeTotals } from "@/lib/quotes/doc";
import { createServiceClient } from "@/lib/supabase/service";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

type ClientRow = { id: string; name: string; quote_prefix: string | null };

export type ResolveClientResult =
  | { ok: true; client: ClientContext }
  | { ok: false; status: number; body: Record<string, unknown> };

/** The company-details lookup (address/attention/registered name) shared by
 *  every route that turns a bare `{id, name}` client row into a full
 *  ClientContext for the assembler. ONE implementation: create's
 *  resolveClient calls it once it has a row (with the quote_prefix check
 *  already applied); amend calls it after loading the quote's client_id,
 *  which needs no prefix check at all. Exported for direct testing. */
export async function buildClientContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any>,
  row: { id: string; name: string },
): Promise<ClientContext> {
  const { data: details } = await sb
    .from("client_company_details")
    .select("registered_name, billing_contact_name, physical_address")
    .eq("client_id", row.id)
    .maybeSingle();

  const addressLines = ((details?.physical_address as string | null) ?? "")
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0);

  return {
    id: row.id,
    name: row.name,
    registeredName: (details?.registered_name as string | null) ?? null,
    attention: (details?.billing_contact_name as string | null) ?? null,
    addressLines,
  };
}

/** Resolves the request body's `clientId`/`client` into a full ClientContext
 *  (address/attention/registered name pulled from client_company_details),
 *  or a ready-to-return error shape. Exported for direct testing. */
export async function resolveClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any>,
  body: Pick<ApiCreateBody, "client" | "clientId">,
): Promise<ResolveClientResult> {
  let row: ClientRow | null = null;

  if (body.clientId) {
    const { data } = await sb.from("clients").select("id, name, quote_prefix").eq("id", body.clientId).maybeSingle();
    if (!data) return { ok: false, status: 404, body: { error: "client not found" } };
    row = data as ClientRow;
  } else if (body.client) {
    const name = body.client;
    const { data } = await sb
      .from("clients")
      .select("id, name, quote_prefix")
      .ilike("name", `%${escapeLike(name)}%`)
      .limit(20);
    const rows = (data ?? []) as ClientRow[];
    if (rows.length === 0) {
      return {
        ok: false,
        status: 404,
        body: { error: `no client matching '${name}' — new clients are created by Shawn, or check the spelling` },
      };
    }
    if (rows.length > 1) {
      return {
        ok: false,
        status: 409,
        body: { error: `'${name}' is ambiguous`, candidates: rows.map((r) => ({ id: r.id, name: r.name })) },
      };
    }
    row = rows[0];
  } else {
    return { ok: false, status: 422, body: { error: "either client or clientId is required" } };
  }

  if (!row.quote_prefix) {
    return {
      ok: false,
      status: 422,
      body: { error: `client '${row.name}' has no quote prefix set — ask Shawn to set one` },
    };
  }

  return { ok: true, client: await buildClientContext(sb, row) };
}

export async function POST(req: Request) {
  try {
    const sb = createServiceClient();
    const auth = await authenticateApiKey(sb, req.headers.get("authorization"));
    if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let body: ApiCreateBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    // A structurally alien body (null, an array, a bare string/number) must
    // read as a validation failure, not crash resolveClient/assembleCreate
    // into a 500 — those go on to do unguarded property access assuming an
    // object.
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "validation failed", details: [{ field: "body", message: "Request body must be a JSON object." }] },
        { status: 422 },
      );
    }

    const resolved = await resolveClient(sb, body);
    if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });

    const assembled = assembleCreate(body, resolved.client, { today: new Date(), actorLabel: auth.actor.label });
    if (!assembled.ok) {
      return NextResponse.json({ error: "validation failed", details: assembled.errors }, { status: 422 });
    }

    // Namespaced per key: "1" from one caller must never replay another
    // caller's quote just because both happened to pick the same
    // Idempotency-Key value — see the service's own doc comment for why the
    // bare header is never used as-is.
    const idempotencyHeader = req.headers.get("idempotency-key");
    const idempotencyKey = idempotencyHeader ? `${auth.keyId}:${idempotencyHeader}` : null;

    const svc = makeQuoteService(sb);
    let result = await svc.create({ ...assembled.input, idempotencyKey }, auth.actor);
    if (!result.ok) {
      // A genuine race: two concurrent identical creates both missed the
      // idempotency SELECT and both attempted the insert; the loser hits the
      // unique index as a raw 23505. Re-run create() once — its idempotency
      // SELECT now finds the winner's row — and return that as a clean
      // replay instead of surfacing the Postgres error.
      if (idempotencyKey && result.error.includes("duplicate key value")) {
        result = await svc.create({ ...assembled.input, idempotencyKey }, auth.actor);
      }
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
    }

    // A replayed create must report the STORED quote's totals, not
    // whatever this particular request's body would compute — the two can
    // differ (this call's body isn't necessarily the one that created the
    // quote), and the response must describe the quote that actually exists.
    let totals: { exVat: number; vat: number; inclVat: number; monthlyInclVat: number | null };
    if (result.replayed) {
      const { data: version } = await sb
        .from("quote_versions")
        .select("subtotal, vat_amount, grand_total, monthly_total")
        .eq("quote_id", result.quoteId)
        .eq("version", result.version)
        .maybeSingle();
      totals = {
        exVat: round2((version?.subtotal as number | null) ?? 0),
        vat: round2((version?.vat_amount as number | null) ?? 0),
        inclVat: round2((version?.grand_total as number | null) ?? 0),
        monthlyInclVat: version?.monthly_total != null ? round2(version.monthly_total as number) : null,
      };
    } else {
      const computed = computeTotals(assembled.input.doc);
      totals = {
        exVat: round2(computed.subtotal),
        vat: round2(computed.vat),
        inclVat: round2(computed.grand),
        monthlyInclVat: computed.monthly != null ? round2(computed.monthly) : null,
      };
    }

    return NextResponse.json(
      {
        quoteId: result.quoteId,
        quoteNumber: result.quoteNumber,
        version: result.version,
        status: result.status,
        replayed: result.replayed,
        totals,
        adminUrl: `${APP_URL}/admin/quotes/${result.quoteId}`,
      },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (e) {
    console.error("POST /api/v1/quotes failed:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
