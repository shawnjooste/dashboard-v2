// POST /api/v1/quotes/{id}/amend — corrects a drafted quote via the scoped
// key API. The one rule this route exists to enforce end to end: an amend
// NEVER leaves a quote live. makeQuoteService(...).amend() is the actual
// enforcement (it always pulls the quote out of 'sent' and, for every API
// caller, lands it in pending_review — see lib/quotes/policy.ts); this route
// only does auth, loading the quote + its client, JSON in/out, and status
// codes. It sends no email itself — amend() sends the reviewer notification.
import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { assembleAmend, round2, type ApiAmendBody } from "@/lib/quotes/api-input";
import { makeQuoteService } from "@/lib/quotes/service";
import { computeTotals } from "@/lib/quotes/doc";
import { createServiceClient } from "@/lib/supabase/service";
import { buildClientContext } from "../../route";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

type QuoteRow = {
  id: string;
  quote_number: string;
  client_id: string;
  checkout_enabled: boolean | null;
  status: string;
};

/** Statuses an HTTP amend may still touch. Everything past this point
 *  (sent, accepted, rejected, changes_requested, expired) is a live or
 *  closed quote — the API refuses outright rather than pulling it back into
 *  review out from under whoever is tracking it, which is what the service's
 *  own wider contract would otherwise do on behalf of a trusted portal/CLI
 *  caller. */
const AMENDABLE_STATUSES = new Set(["draft", "pending_review"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sb = createServiceClient();
    const auth = await authenticateApiKey(sb, req.headers.get("authorization"));
    if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await params;

    let body: ApiAmendBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    // A structurally alien body (null, an array, a bare string/number) must
    // read as a validation failure, not crash assembleAmend into a 500.
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "validation failed", details: [{ field: "body", message: "Request body must be a JSON object." }] },
        { status: 422 },
      );
    }

    const { data: quote } = await sb
      .from("quotes")
      .select("id, quote_number, client_id, checkout_enabled, status")
      .eq("id", id)
      .maybeSingle();
    if (!quote) return NextResponse.json({ error: "quote not found" }, { status: 404 });
    const quoteRow = quote as QuoteRow;

    if (!AMENDABLE_STATUSES.has(quoteRow.status)) {
      return NextResponse.json(
        {
          error: `this quote is in status "${quoteRow.status}" — the API can only amend quotes still in review; changes to live quotes go through Shawn`,
        },
        { status: 409 },
      );
    }

    const { data: clientRow } = await sb.from("clients").select("id, name").eq("id", quoteRow.client_id).maybeSingle();
    if (!clientRow) return NextResponse.json({ error: "client not found" }, { status: 404 });

    const client = await buildClientContext(sb, clientRow as { id: string; name: string });

    const assembled = assembleAmend(body, client, {
      today: new Date(),
      actorLabel: auth.actor.label,
      checkout: quoteRow.checkout_enabled ?? false,
    });
    if (!assembled.ok) {
      return NextResponse.json({ error: "validation failed", details: assembled.errors }, { status: 422 });
    }

    const svc = makeQuoteService(sb);
    const result = await svc.amend(id, assembled.input, auth.actor);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });

    const totals = computeTotals(assembled.input.doc);
    return NextResponse.json({
      quoteId: id,
      quoteNumber: quoteRow.quote_number,
      version: result.version,
      status: result.status,
      totals: {
        exVat: round2(totals.subtotal),
        vat: round2(totals.vat),
        inclVat: round2(totals.grand),
        monthlyInclVat: totals.monthly != null ? round2(totals.monthly) : null,
      },
      adminUrl: `${APP_URL}/admin/quotes/${id}`,
    });
  } catch (e) {
    console.error("POST /api/v1/quotes/[id]/amend failed:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
