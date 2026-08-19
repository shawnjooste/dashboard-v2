import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { typeRank, worstType } from "@/lib/status-helpers";

export type PublicIncident = {
  id: string;
  title: string;
  type: string;
  startedAt: string;
  /** Newest update only — the login panel is a summary, not a timeline. */
  latest: { body: string; createdAt: string } | null;
};

export type PublicStatus = {
  /** Worst active type; null = all clear. */
  worst: string | null;
  active: PublicIncident[];
  recent: { id: string; title: string; resolvedAt: string | null }[];
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

type RawUpdate = { incident_id: string; body: string; created_at: string };

const EMPTY: PublicStatus = { worst: null, active: [], recent: [] };
const RECENT_CAP = 5;

/** Pure shaping, so the rules are testable without a database. */
export function shapePublicStatus(incidents: RawIncident[], updates: RawUpdate[]): PublicStatus {
  // Redundant with the query filter in getPublicStatus, and deliberately so:
  // if that query is ever widened, this is what keeps client-scoped incidents
  // off a page anyone on the internet can read.
  const global = incidents.filter((i) => i.scope === "global");

  const newest = new Map<string, RawUpdate>();
  for (const u of updates) {
    const held = newest.get(u.incident_id);
    if (!held || u.created_at > held.created_at) newest.set(u.incident_id, u);
  }

  const active = global
    .filter((i) => i.status === "active")
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || b.started_at.localeCompare(a.started_at))
    .map((i) => {
      const u = newest.get(i.id);
      return {
        id: i.id,
        title: i.title,
        type: i.type,
        startedAt: i.started_at,
        latest: u ? { body: u.body, createdAt: u.created_at } : null,
      };
    });

  const recent = global
    .filter((i) => i.status === "resolved")
    .sort((a, b) => (b.resolved_at ?? "").localeCompare(a.resolved_at ?? ""))
    .slice(0, RECENT_CAP)
    .map((i) => ({ id: i.id, title: i.title, resolvedAt: i.resolved_at }));

  return { worst: worstType(active.map((i) => i.type)), active, recent };
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
      .limit(40);
    if (error || !incidents?.length) return EMPTY;

    const { data: updates } = await service
      .from("status_updates")
      .select("incident_id, body, created_at")
      .in(
        "incident_id",
        incidents.filter((i) => i.status === "active").map((i) => i.id),
      );

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
