import { createClient } from "@/lib/supabase/server";

export type SecurityEventRow = {
  id: string;
  kind: string;
  source: string;
  category: string;
  severity: string;
  clientId: string;
  clientName: string;
  entityLabel: string | null;
  title: string;
  detail: string | null;
  occurredAt: string;
  resolved: boolean;
  triageState: string;
};

const CAP = 500;

/** Normalized security events, newest first, staff-only via RLS. */
export async function getSecurityEvents(filters: {
  severity?: string;
  kind?: string;
  clientId?: string;
  triage?: string;
  openOnly?: boolean;
}): Promise<{ events: SecurityEventRow[]; capped: boolean; totals: Record<string, number> }> {
  const supabase = await createClient();
  let q = supabase
    .from("security_events")
    .select("id, kind, source, category, severity, client_id, entity_label, title, detail, occurred_at, resolved, triage_state")
    .order("occurred_at", { ascending: false })
    .limit(CAP);
  if (filters.severity) q = q.eq("severity", filters.severity);
  if (filters.kind) q = q.eq("kind", filters.kind);
  if (filters.clientId) q = q.eq("client_id", filters.clientId);
  if (filters.triage) q = q.eq("triage_state", filters.triage);
  if (filters.openOnly) q = q.eq("resolved", false);
  const [{ data, error }, { data: clients }] = await Promise.all([q, supabase.from("clients").select("id, name")]);
  if (error) throw new Error(error.message);
  const name = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const events = (data ?? []).map((e) => ({
    id: e.id,
    kind: e.kind,
    source: e.source,
    category: e.category,
    severity: e.severity,
    clientId: e.client_id,
    clientName: name.get(e.client_id) ?? "—",
    entityLabel: e.entity_label,
    title: e.title,
    detail: e.detail,
    occurredAt: e.occurred_at,
    resolved: e.resolved,
    triageState: e.triage_state,
  }));
  const totals: Record<string, number> = {};
  for (const e of events) totals[e.severity] = (totals[e.severity] ?? 0) + 1;
  return { events, capped: (data?.length ?? 0) === CAP, totals };
}
