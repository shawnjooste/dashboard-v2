// GET /api/v1/clients?search= — name resolution helper for the scoped key
// API. Read-only, never creates a client (client creation stays a Shawn-only
// action, out of scope for this API — see the design spec's "Out of scope").
import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { escapeLike } from "@/lib/quotes/api-input";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(req: Request) {
  try {
    const sb = createServiceClient();
    const auth = await authenticateApiKey(sb, req.headers.get("authorization"));
    if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const search = new URL(req.url).searchParams.get("search") ?? "";
    if (search.trim().length < 2) {
      return NextResponse.json({ error: "search must be at least 2 characters" }, { status: 422 });
    }

    const { data, error } = await sb
      .from("clients")
      .select("id, name, quote_prefix")
      .ilike("name", `%${escapeLike(search)}%`)
      .order("name")
      .limit(20);
    if (error) throw new Error(error.message);

    const results = ((data ?? []) as { id: string; name: string; quote_prefix: string | null }[]).map((c) => ({
      id: c.id,
      name: c.name,
      quotePrefix: c.quote_prefix,
    }));
    return NextResponse.json(results);
  } catch (e) {
    console.error("GET /api/v1/clients failed:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
