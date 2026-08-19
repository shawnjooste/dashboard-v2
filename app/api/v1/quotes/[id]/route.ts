// GET /api/v1/quotes/{id} — read-only status + totals lookup for the scoped
// key API. No internal costs (quote_internal) are ever exposed here.
import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { round2 } from "@/lib/quotes/api-input";
import { createServiceClient } from "@/lib/supabase/service";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sb = createServiceClient();
    const auth = await authenticateApiKey(sb, req.headers.get("authorization"));
    if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await params;

    const { data: quote } = await sb
      .from("quotes")
      .select("id, quote_number, status, current_version")
      .eq("id", id)
      .maybeSingle();
    if (!quote) return NextResponse.json({ error: "quote not found" }, { status: 404 });

    const { data: version } = await sb
      .from("quote_versions")
      .select("subtotal, vat_amount, grand_total, monthly_total")
      .eq("quote_id", id)
      .eq("version", quote.current_version)
      .maybeSingle();

    return NextResponse.json({
      quoteNumber: quote.quote_number,
      status: quote.status,
      version: quote.current_version,
      totals: {
        exVat: round2((version?.subtotal as number | null) ?? 0),
        vat: round2((version?.vat_amount as number | null) ?? 0),
        inclVat: round2((version?.grand_total as number | null) ?? 0),
        monthlyInclVat: version?.monthly_total != null ? round2(version.monthly_total as number) : null,
      },
      portalUrl: `${APP_URL}/quotes/${id}`,
      adminUrl: `${APP_URL}/admin/quotes/${id}`,
    });
  } catch (e) {
    console.error("GET /api/v1/quotes/[id] failed:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
