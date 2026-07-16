import { createClient } from "@/lib/supabase/server";
import { SECTION_LABELS } from "@/lib/activity-helpers";

export type ActivityGroup = "logins" | "views" | "actions" | "changes" | "quotes" | "syncs" | "emails";

export type ActivityItem = {
  at: string;
  group: ActivityGroup;
  actor: string | null;
  clientId: string | null;
  clientName: string | null;
  text: string;
  href?: string;
};

const CAP = 500;

/** Everything that happened across the portal in the last `days` days,
 *  merged newest-first from portal_activity + the domain event tables.
 *  Staff-only by construction: every query runs under the caller's RLS. */
export async function getActivity(days: number): Promise<{ items: ActivityItem[]; capped: boolean }> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [activity, quoteEvents, quotes, rfqEvents, rfqs, changes, devices, time, imports, imp, profiles, clients] =
    await Promise.all([
      supabase.from("portal_activity").select("occurred_at, profile_id, client_id, kind, section, detail").gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(CAP),
      supabase.from("quote_events").select("created_at, quote_id, event, actor_profile_id").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
      supabase.from("quotes").select("id, quote_number, client_id"),
      supabase.from("rfq_events").select("created_at, rfq_id, kind, body, posted_by_profile_id").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
      supabase.from("rfqs").select("id, title, client_id"),
      supabase.from("device_changes").select("created_at, device_id, category, note, created_by_profile_id").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
      supabase.from("devices").select("id, hostname, client_id"),
      supabase.from("support_time_entries").select("created_at, client_id, minutes, work_type, note, entered_by").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
      supabase.from("import_runs").select("created_at, source, counts").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
      supabase.from("impersonation_log").select("started_at, staff_profile_id, target_email").gte("started_at", since).order("started_at", { ascending: false }).limit(CAP),
      supabase.from("profiles").select("id, email"),
      supabase.from("clients").select("id, name"),
    ]);

  const email = new Map((profiles.data ?? []).map((p) => [p.id, p.email]));
  const person = (id: string | null) => {
    const e = id ? email.get(id) : null;
    return e ? e.split("@")[0].replace(/[._]/g, " ") : null;
  };
  const clientName = new Map((clients.data ?? []).map((c) => [c.id, c.name]));
  const quoteById = new Map((quotes.data ?? []).map((q) => [q.id, q]));
  const rfqById = new Map((rfqs.data ?? []).map((r) => [r.id, r]));
  const deviceById = new Map((devices.data ?? []).map((d) => [d.id, d]));

  const items: ActivityItem[] = [];
  const push = (i: ActivityItem) => items.push(i);
  const named = (clientId: string | null) => (clientId ? (clientName.get(clientId) ?? null) : null);

  for (const a of activity.data ?? []) {
    const base = { at: a.occurred_at, actor: person(a.profile_id), clientId: a.client_id, clientName: named(a.client_id) };
    if (a.kind === "login") push({ ...base, group: "logins", text: "signed in" });
    else if (a.kind === "visit") push({ ...base, group: "views", text: `viewed ${SECTION_LABELS[a.section] ?? a.section}` });
    else if (a.kind === "email") push({ ...base, group: "emails", text: `${a.section.replace("_", " ")} email sent${a.detail ? `: ${a.detail}` : ""}` });
    else if (a.section === "ticket_created") push({ ...base, group: "actions", text: `raised a ticket${a.detail ? `: “${a.detail}”` : ""}` });
    else push({ ...base, group: "actions", text: `${a.section}${a.detail ? ` — ${a.detail}` : ""}` });
  }
  for (const e of quoteEvents.data ?? []) {
    const q = quoteById.get(e.quote_id);
    push({
      at: e.created_at, group: "quotes", actor: person(e.actor_profile_id),
      clientId: q?.client_id ?? null, clientName: named(q?.client_id ?? null),
      text: `quote ${q?.quote_number ?? "?"} ${e.event.replace("_", " ")}`,
      href: `/admin/quotes/${e.quote_id}`,
    });
  }
  for (const e of rfqEvents.data ?? []) {
    const r = rfqById.get(e.rfq_id);
    push({
      at: e.created_at, group: "changes", actor: person(e.posted_by_profile_id),
      clientId: r?.client_id ?? null, clientName: named(r?.client_id ?? null),
      text: `RFQ “${r?.title ?? "?"}” — ${e.kind}${e.body ? `: ${e.body}` : ""}`,
      href: `/admin/rfqs/${e.rfq_id}`,
    });
  }
  for (const c of changes.data ?? []) {
    const d = deviceById.get(c.device_id);
    push({
      at: c.created_at, group: "changes", actor: person(c.created_by_profile_id),
      clientId: d?.client_id ?? null, clientName: named(d?.client_id ?? null),
      text: `logged ${c.category} change on ${d?.hostname ?? "a device"}: ${c.note.slice(0, 80)}`,
      href: `/admin/devices/${c.device_id}`,
    });
  }
  for (const t of time.data ?? []) {
    push({
      at: t.created_at, group: "changes", actor: person(t.entered_by),
      clientId: t.client_id, clientName: named(t.client_id),
      text: `logged ${t.minutes}m ${t.work_type} support${t.note ? `: ${t.note.slice(0, 60)}` : ""}`,
    });
  }
  for (const r of imports.data ?? []) {
    const counts = Object.entries((r.counts as Record<string, unknown>) ?? {})
      .filter(([, v]) => typeof v === "number" && v > 0)
      .slice(0, 3)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    push({ at: r.created_at, group: "syncs", actor: null, clientId: null, clientName: null, text: `${r.source} sync${counts ? ` — ${counts}` : ""}` });
  }
  for (const i of imp.data ?? []) {
    push({ at: i.started_at, group: "actions", actor: person(i.staff_profile_id), clientId: null, clientName: null, text: `viewed the portal as ${i.target_email}` });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  const capped = [activity, quoteEvents, rfqEvents, changes, time, imports, imp].some((r) => (r.data?.length ?? 0) === CAP);
  return { items, capped };
}
