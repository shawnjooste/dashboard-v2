import { createClient } from "@/lib/supabase/server";
import { monthKey, resolvePackage, usedMinutesInMonth } from "@/lib/support-package-helpers";

export type SupportPackage = {
  id: string;
  key: string;
  name: string;
  rank: number;
  includedMinutes: number;
  slaHours: number | null;
  hasChat: boolean;
  remoteIncluded: boolean;
  isDefault: boolean;
};

export type SupportStatus = {
  pkg: SupportPackage | null;
  planLabel: string | null;
  usedMinutes: number;
};

export type TimeEntry = {
  id: string;
  minutes: number;
  workType: string;
  note: string | null;
  freescoutNumber: number | null;
  author: string | null;
  occurredOn: string;
};

const toPkg = (r: {
  id: string; key: string; name: string; rank: number; included_minutes: number;
  sla_hours: number | null; has_chat: boolean; remote_included: boolean; is_default: boolean;
}): SupportPackage => ({
  id: r.id,
  key: r.key,
  name: r.name,
  rank: r.rank,
  includedMinutes: r.included_minutes,
  slaHours: r.sla_hours,
  hasChat: r.has_chat,
  remoteIncluded: r.remote_included,
  isDefault: r.is_default,
});

export async function getSupportPackages(): Promise<SupportPackage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_packages")
    .select("id, key, name, rank, included_minutes, sla_hours, has_chat, remote_included, is_default")
    .order("rank");
  return (data ?? []).map(toPkg);
}

/** Package + plan label + current-month usage for one client. RLS scopes
 *  every query: clients see only their own row/entries, staff see all. */
export async function getSupportStatus(clientId: string): Promise<SupportStatus> {
  const supabase = await createClient();
  const key = monthKey(new Date());
  const [packages, clientRow, entries] = await Promise.all([
    getSupportPackages(),
    supabase.from("clients").select("support_package_id, support_plan_label").eq("id", clientId).maybeSingle(),
    supabase.from("support_time_entries").select("occurred_on, minutes").eq("client_id", clientId).gte("occurred_on", `${key}-01`),
  ]);
  return {
    pkg: resolvePackage(packages, clientRow.data?.support_package_id ?? null),
    planLabel: clientRow.data?.support_plan_label ?? null,
    usedMinutes: usedMinutesInMonth(entries.data ?? [], key),
  };
}

/** This month's ledger entries for a client, newest first. */
export async function getTimeEntries(clientId: string, key: string): Promise<TimeEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_time_entries")
    .select("id, minutes, work_type, note, freescout_number, entered_by, occurred_on")
    .eq("client_id", clientId)
    .gte("occurred_on", `${key}-01`)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });
  const { data: profiles } = await supabase.from("profiles").select("id, email");
  const email = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const label = (id: string | null) => {
    const e = id ? email.get(id) : null;
    return e ? e.split("@")[0].replace(/[._]/g, " ") : null;
  };
  return (data ?? []).map((e) => ({
    id: e.id,
    minutes: e.minutes,
    workType: e.work_type,
    note: e.note,
    freescoutNumber: e.freescout_number,
    author: label(e.entered_by),
    occurredOn: e.occurred_on,
  }));
}
