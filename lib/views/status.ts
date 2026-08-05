import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { worstType, typeRank } from "@/lib/status-helpers";
import type { ActiveIncident } from "@/lib/incident-mode";

export type StatusUpdate = {
  id: string;
  body: string;
  isResolution: boolean;
  createdAt: string;
  author: string | null;
};

export type StatusIncident = {
  id: string;
  title: string;
  type: string;
  status: string;
  scope: string;
  startedAt: string;
  resolvedAt: string | null;
  /** While active, this incident gives everyone who can see it live chat. */
  opensChat: boolean;
  /** Staff only — clients never see which OTHER clients are affected. */
  clientNames: string[];
  updates: StatusUpdate[];
};

const HISTORY_CAP = 50;

/** Everything the /status page needs. RLS scopes every query: staff see all,
 *  a client sees global incidents plus their own. */
export async function getStatusPage(): Promise<{
  active: StatusIncident[];
  history: StatusIncident[];
  subscribed: boolean;
}> {
  const supabase = await createClient();
  const me = await getCurrentProfile();
  const isStaff = me.authenticated && me.profile.role === "rocking_staff";

  const [incidentsRes, updatesRes, targetsRes, clientsRes, subsRes, profilesRes] = await Promise.all([
    supabase
      .from("status_incidents")
      .select("id, title, type, status, scope, started_at, resolved_at, opens_chat")
      .order("started_at", { ascending: false })
      .limit(HISTORY_CAP + 50),
    supabase
      .from("status_updates")
      .select("id, incident_id, body, is_resolution, created_at, created_by")
      .order("created_at", { ascending: false }),
    isStaff
      ? supabase.from("status_incident_clients").select("incident_id, client_id")
      : Promise.resolve({ data: [] as { incident_id: string; client_id: string }[] }),
    isStaff
      ? supabase.from("clients").select("id, name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    me.authenticated
      ? supabase.from("status_subscriptions").select("profile_id").eq("profile_id", me.profile.id)
      : Promise.resolve({ data: [] as { profile_id: string }[] }),
    supabase.from("profiles").select("id, email"),
  ]);

  const emailById = new Map((profilesRes.data ?? []).map((p) => [p.id, p.email]));
  const author = (id: string | null) => {
    const e = id ? emailById.get(id) : null;
    return e ? e.split("@")[0].replace(/[._]/g, " ") : null;
  };
  const clientName = new Map((clientsRes.data ?? []).map((c) => [c.id, c.name]));
  const namesByIncident = new Map<string, string[]>();
  for (const t of targetsRes.data ?? []) {
    const list = namesByIncident.get(t.incident_id) ?? [];
    list.push(clientName.get(t.client_id) ?? "—");
    namesByIncident.set(t.incident_id, list);
  }
  const updatesByIncident = new Map<string, StatusUpdate[]>();
  for (const u of updatesRes.data ?? []) {
    const list = updatesByIncident.get(u.incident_id) ?? [];
    list.push({
      id: u.id,
      body: u.body,
      isResolution: u.is_resolution,
      createdAt: u.created_at,
      author: author(u.created_by),
    });
    updatesByIncident.set(u.incident_id, list);
  }

  const all: StatusIncident[] = (incidentsRes.data ?? []).map((i) => ({
    id: i.id,
    title: i.title,
    type: i.type,
    status: i.status,
    scope: i.scope,
    startedAt: i.started_at,
    resolvedAt: i.resolved_at,
    opensChat: i.opens_chat,
    clientNames: (namesByIncident.get(i.id) ?? []).sort(),
    updates: updatesByIncident.get(i.id) ?? [],
  }));

  const active = all
    .filter((i) => i.status === "active")
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || b.startedAt.localeCompare(a.startedAt));
  const history = all.filter((i) => i.status === "resolved").slice(0, HISTORY_CAP);

  return { active, history, subscribed: (subsRes.data ?? []).length > 0 };
}

/** Worst active incident type visible to the caller — drives the top-bar dot.
 *  Never throws: the shell must render even if this query fails. */
export async function getStatusIndicator(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("status_incidents").select("type").eq("status", "active");
    return worstType((data ?? []).map((i) => i.type));
  } catch (e) {
    console.error("status indicator failed:", e);
    return null;
  }
}

/** Every active incident the caller can see, newest first — one query that
 *  feeds all three shell decisions: the dot's colour, whether to banner, and
 *  whether chat is open to this viewer. RLS does the scoping, so a
 *  client-scoped incident never leaks to a client it doesn't target.
 *
 *  Never throws, for the same reason as the indicator: the portal must render
 *  even when the status table doesn't answer. Failing closed here means no
 *  banner and no chat override, never a broken page. */
export async function getActiveIncidents(): Promise<ActiveIncident[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("status_incidents")
      .select("id, title, type, opens_chat")
      .eq("status", "active")
      .order("started_at", { ascending: false });
    return (data ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      type: i.type,
      opensChat: i.opens_chat,
    }));
  } catch (e) {
    console.error("active incidents failed:", e);
    return [];
  }
}
