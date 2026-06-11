import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  derivedStatus,
  type DerivedStatus,
  type QuoteDoc,
  type QuoteStatus,
} from "@/lib/quotes/doc";

export type QuoteListRow = {
  id: string;
  quoteNumber: string;
  title: string;
  status: DerivedStatus;
  grandTotal: number | null;
  monthlyTotal: number | null;
  validUntil: string | null;
  createdAt: string;
};

export type QuoteDecision = {
  event: "accepted" | "rejected" | "changes_requested";
  actorName: string | null;
  comment: string | null;
  at: string;
} | null;

export type QuoteDetail = {
  id: string;
  clientId: string;
  quoteNumber: string;
  title: string;
  status: DerivedStatus;
  rawStatus: QuoteStatus;
  version: number;
  doc: QuoteDoc;
  grandTotal: number | null;
  monthlyTotal: number | null;
  validUntil: string | null;
  decision: QuoteDecision;
};

type QuoteRow = {
  id: string;
  client_id: string;
  quote_number: string;
  title: string;
  status: string;
  current_version: number;
  created_at: string;
};

async function listRows(rows: QuoteRow[] | null, versionsFor: (q: QuoteRow) => { grand_total: number | null; monthly_total: number | null; valid_until: string | null } | undefined): Promise<QuoteListRow[]> {
  return (rows ?? []).map((q) => {
    const v = versionsFor(q);
    return {
      id: q.id,
      quoteNumber: q.quote_number,
      title: q.title,
      status: derivedStatus(q.status as QuoteStatus, v?.valid_until ?? null),
      grandTotal: v?.grand_total ?? null,
      monthlyTotal: v?.monthly_total ?? null,
      validUntil: v?.valid_until ?? null,
      createdAt: q.created_at,
    };
  });
}

/** Quotes visible to the caller (RLS: manager → own client, latest version only). */
export async function getVisibleQuotes(clientId?: string): Promise<QuoteListRow[]> {
  const supabase = await createClient();
  let quotesQ = supabase
    .from("quotes")
    .select("id, client_id, quote_number, title, status, current_version, created_at")
    .order("created_at", { ascending: false });
  if (clientId) quotesQ = quotesQ.eq("client_id", clientId);
  const { data: quotes } = await quotesQ;
  const ids = (quotes ?? []).map((q) => q.id);
  if (ids.length === 0) return [];
  const { data: versions } = await supabase
    .from("quote_versions")
    .select("quote_id, version, grand_total, monthly_total, valid_until")
    .in("quote_id", ids);
  const byKey = new Map((versions ?? []).map((v) => [`${v.quote_id}|${v.version}`, v]));
  return listRows(quotes, (q) => byKey.get(`${q.id}|${q.current_version}`));
}

async function loadDecision(quoteId: string): Promise<QuoteDecision> {
  // Service client: the joined actor profile may not be visible to the caller's RLS.
  const service = createServiceClient();
  const { data } = await service
    .from("quote_events")
    .select("event, comment, created_at, actor_profile_id, profiles:actor_profile_id (email)")
    .eq("quote_id", quoteId)
    .in("event", ["accepted", "rejected", "changes_requested"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const profile = data.profiles as { email: string } | null;
  return {
    event: data.event as "accepted" | "rejected" | "changes_requested",
    actorName: profile?.email ?? null,
    comment: data.comment,
    at: data.created_at,
  };
}

/** One quote with its current version's document (RLS-scoped read). */
export async function getQuoteDetail(quoteId: string): Promise<QuoteDetail | null> {
  const supabase = await createClient();
  const { data: q } = await supabase
    .from("quotes")
    .select("id, client_id, quote_number, title, status, current_version")
    .eq("id", quoteId)
    .maybeSingle();
  if (!q) return null;
  const { data: v } = await supabase
    .from("quote_versions")
    .select("version, doc, grand_total, monthly_total, valid_until")
    .eq("quote_id", q.id)
    .eq("version", q.current_version)
    .maybeSingle();
  if (!v) return null;

  const rawStatus = q.status as QuoteStatus;
  const decision = rawStatus === "sent" ? null : await loadDecision(q.id);
  return {
    id: q.id,
    clientId: q.client_id,
    quoteNumber: q.quote_number,
    title: q.title,
    status: derivedStatus(rawStatus, v.valid_until),
    rawStatus,
    version: v.version,
    doc: v.doc as QuoteDoc,
    grandTotal: v.grand_total,
    monthlyTotal: v.monthly_total,
    validUntil: v.valid_until,
    decision,
  };
}

// ---------- admin extras ----------

export type QuoteVersionSummary = {
  version: number;
  createdAt: string;
  grandTotal: number | null;
  supplierCost: number | null;
  margin: number | null;
};

export type QuoteEventRow = {
  event: string;
  actorName: string | null;
  comment: string | null;
  at: string;
  version: number | null;
};

export type QuoteAdminDetail = QuoteDetail & {
  versions: QuoteVersionSummary[];
  events: QuoteEventRow[];
  /** Current version's margin: grand total ex VAT minus supplier costs. */
  supplierCost: number | null;
  margin: number | null;
};

/** Staff view: detail + history + events + margin (staff RLS sees everything). */
export async function getQuoteAdminDetail(quoteId: string): Promise<QuoteAdminDetail | null> {
  const base = await getQuoteDetail(quoteId);
  if (!base) return null;
  const supabase = await createClient();
  const [versionsRes, eventsRes] = await Promise.all([
    supabase
      .from("quote_versions")
      .select("id, version, created_at, grand_total, subtotal")
      .eq("quote_id", quoteId)
      .order("version", { ascending: false }),
    supabase
      .from("quote_events")
      .select("event, comment, created_at, version, profiles:actor_profile_id (email)")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false }),
  ]);
  const versionIds = (versionsRes.data ?? []).map((v) => v.id);
  const { data: internal } = versionIds.length
    ? await supabase.from("quote_internal").select("version_id, supplier_cost").in("version_id", versionIds)
    : { data: [] as { version_id: string; supplier_cost: number | null }[] };
  const costBy = new Map<string, number>();
  for (const r of internal ?? []) {
    if (r.supplier_cost != null)
      costBy.set(r.version_id, (costBy.get(r.version_id) ?? 0) + Number(r.supplier_cost));
  }

  const versions: QuoteVersionSummary[] = (versionsRes.data ?? []).map((v) => {
    const cost = costBy.has(v.id) ? costBy.get(v.id)! : null;
    const margin = cost !== null && v.subtotal !== null ? Number(v.subtotal) - cost : null;
    return {
      version: v.version,
      createdAt: v.created_at,
      grandTotal: v.grand_total,
      supplierCost: cost,
      margin,
    };
  });
  const current = versions.find((v) => v.version === base.version);

  return {
    ...base,
    versions,
    events: (eventsRes.data ?? []).map((e) => ({
      event: e.event,
      actorName: (e.profiles as { email: string } | null)?.email ?? null,
      comment: e.comment,
      at: e.created_at,
      version: e.version,
    })),
    supplierCost: current?.supplierCost ?? null,
    margin: current?.margin ?? null,
  };
}
