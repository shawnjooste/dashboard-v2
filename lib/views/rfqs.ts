import { createClient } from "@/lib/supabase/server";
import { rfqDisplayName, rfqCardTag, type RfqStatus, type CardTag } from "./rfq-helpers";

export * from "./rfq-helpers";

export type RfqCard = {
  id: string;
  title: string;
  clientLabel: string;
  requestedBy: string | null;
  status: RfqStatus;
  tag: CardTag | null;
  updatedAt: string;
};

export type RfqEvent = { id: string; kind: string; body: string | null; author: string | null; createdAt: string };
export type QuoteOption = { id: string; label: string };
export type ClientOption = { id: string; name: string };

export type RfqDetail = {
  id: string;
  title: string;
  clientId: string | null;
  clientLabel: string;
  requestedBy: string | null;
  description: string | null;
  neededBy: string | null;
  status: RfqStatus;
  sourcingNote: string | null;
  lostReason: string | null;
  notes: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  events: RfqEvent[];
  linkableQuotes: QuoteOption[];
};

/** A friendly label from an email local-part (staff rarely have people rows). */
function emailLabel(email: string | undefined | null): string | null {
  if (!email) return null;
  return email.split("@")[0].replace(/[._]/g, " ");
}

/** Every RFQ for the board (staff RLS). */
export async function getRfqBoard(): Promise<RfqCard[]> {
  const supabase = await createClient();
  const [{ data: rfqs }, { data: clients }, { data: quotes }] = await Promise.all([
    supabase
      .from("rfqs")
      .select("id, title, client_id, client_name, requested_by, status, sourcing_note, quote_id, updated_at")
      .order("updated_at", { ascending: false }),
    supabase.from("clients").select("id, name"),
    supabase.from("quotes").select("id, quote_number"),
  ]);
  const cn = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const qn = new Map((quotes ?? []).map((q) => [q.id, q.quote_number]));
  return (rfqs ?? []).map((r) => {
    const status = r.status as RfqStatus;
    const quoteNumber = r.quote_id ? qn.get(r.quote_id) ?? null : null;
    return {
      id: r.id,
      title: r.title,
      clientLabel: rfqDisplayName(r.client_id ? cn.get(r.client_id) ?? null : null, r.client_name),
      requestedBy: r.requested_by,
      status,
      tag: rfqCardTag(status, r.sourcing_note, quoteNumber),
      updatedAt: r.updated_at,
    };
  });
}

export async function getRfqDetail(id: string): Promise<RfqDetail | null> {
  const supabase = await createClient();
  const { data: r } = await supabase.from("rfqs").select("*").eq("id", id).maybeSingle();
  if (!r) return null;
  const [{ data: client }, { data: events }, { data: profiles }, quoteRes, linkable] = await Promise.all([
    r.client_id
      ? supabase.from("clients").select("name").eq("id", r.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("rfq_events").select("id, kind, body, posted_by_profile_id, created_at").eq("rfq_id", id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, email"),
    r.quote_id
      ? supabase.from("quotes").select("quote_number").eq("id", r.quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    r.client_id
      ? supabase.from("quotes").select("id, quote_number, title").eq("client_id", r.client_id).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const em = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const linkedName = (client as { name: string } | null)?.name ?? null;
  return {
    id: r.id,
    title: r.title,
    clientId: r.client_id,
    clientLabel: rfqDisplayName(linkedName, r.client_name),
    requestedBy: r.requested_by,
    description: r.description,
    neededBy: r.needed_by,
    status: r.status as RfqStatus,
    sourcingNote: r.sourcing_note,
    lostReason: r.lost_reason,
    notes: r.notes,
    quoteId: r.quote_id,
    quoteNumber: (quoteRes.data as { quote_number: string } | null)?.quote_number ?? null,
    events: (events ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      body: e.body,
      author: emailLabel(em.get(e.posted_by_profile_id ?? "")),
      createdAt: e.created_at,
    })),
    linkableQuotes: ((linkable.data ?? []) as { id: string; quote_number: string; title: string }[]).map((q) => ({
      id: q.id,
      label: `${q.quote_number} · ${q.title}`,
    })),
  };
}

export async function getRfqFormClients(): Promise<ClientOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, name").order("name");
  return (data ?? []).map((c) => ({ id: c.id, name: c.name }));
}
