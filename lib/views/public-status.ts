import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { typeRank, worstType } from "@/lib/status-helpers";

export type PublicUpdate = {
  id: string;
  body: string;
  createdAt: string;
  isResolution: boolean;
};

export type PublicIncident = {
  id: string;
  title: string;
  type: string;
  startedAt: string;
  resolvedAt: string | null;
  /** Full timeline, newest first. */
  updates: PublicUpdate[];
};

export type PublicStatus = {
  /** Worst active type; null = all clear. */
  worst: string | null;
  active: PublicIncident[];
  past: PublicIncident[];
};

type RawIncident = {
  id: string;
  title: string;
  type: string;
  scope: string;
  status: string;
  started_at: string;
  resolved_at: string | null;
};

type RawUpdate = {
  id: string;
  incident_id: string;
  body: string;
  created_at: string;
  is_resolution: boolean;
};

const EMPTY: PublicStatus = { worst: null, active: [], past: [] };
const PAST_CAP = 10;
const INCIDENT_CAP = 60;

/** Pure shaping, so the rules are testable without a database. */
export function shapePublicStatus(incidents: RawIncident[], updates: RawUpdate[]): PublicStatus {
  // Redundant with the query filter in getPublicStatus, and deliberately so:
  // if that query is ever widened, this is what keeps client-scoped incidents
  // off a page anyone on the internet can read.
  const global = incidents.filter((i) => i.scope === "global");
  const visible = new Set(global.map((i) => i.id));

  const byIncident = new Map<string, PublicUpdate[]>();
  for (const u of updates) {
    if (!visible.has(u.incident_id)) continue;
    const list = byIncident.get(u.incident_id) ?? [];
    list.push({
      id: u.id,
      body: u.body,
      createdAt: u.created_at,
      isResolution: u.is_resolution,
    });
    byIncident.set(u.incident_id, list);
  }
  for (const list of byIncident.values()) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const shape = (i: RawIncident): PublicIncident => ({
    id: i.id,
    title: i.title,
    type: i.type,
    startedAt: i.started_at,
    resolvedAt: i.resolved_at,
    updates: byIncident.get(i.id) ?? [],
  });

  const active = global
    .filter((i) => i.status === "active")
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || b.started_at.localeCompare(a.started_at))
    .map(shape);

  const past = global
    .filter((i) => i.status === "resolved")
    .sort((a, b) => (b.resolved_at ?? "").localeCompare(a.resolved_at ?? ""))
    .slice(0, PAST_CAP)
    .map(shape);

  return { worst: worstType(active.map((i) => i.type)), active, past };
}

/** Status for people who are NOT signed in.
 *
 *  Reads with the service client and hard-codes scope = 'global'. The
 *  alternative — opening RLS to the anon role — would make correctness depend
 *  on a policy predicate that a later migration could loosen. Here the query
 *  IS the boundary: it cannot select a client-scoped row, and it never touches
 *  status_incident_clients, so no client name can reach the response.
 *
 *  Never throws. The login page has to render when the database is slow or
 *  down — an outage makes both likely, and a status panel that took the
 *  sign-in form with it would be worse than no panel at all. */
async function readPublicStatus(): Promise<PublicStatus> {
  try {
    const service = createServiceClient();
    const { data: incidents, error } = await service
      .from("status_incidents")
      .select("id, title, type, scope, status, started_at, resolved_at")
      .eq("scope", "global")
      .order("started_at", { ascending: false })
      .limit(INCIDENT_CAP);
    if (error || !incidents?.length) return EMPTY;

    // Updates for every incident we might render — past incidents show their
    // timeline too, behind a disclosure.
    const { data: updates } = await service
      .from("status_updates")
      .select("id, incident_id, body, created_at, is_resolution")
      .in("incident_id", incidents.map((i) => i.id));

    return shapePublicStatus(incidents, updates ?? []);
  } catch (e) {
    console.error("public status read failed:", e);
    return EMPTY;
  }
}

/** /login is the most-hit and most-attacked route in the portal, so the read is
 *  cached: an uncached query per anonymous request is a cheap amplifier. Up to
 *  a minute of staleness during an incident is the accepted trade. */
export const getPublicStatus = unstable_cache(readPublicStatus, ["public-status"], {
  revalidate: 60,
});
