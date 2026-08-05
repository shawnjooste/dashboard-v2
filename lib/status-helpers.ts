/** Pure status-page logic — no server imports (vitest-safe). Severity
 *  ranking and email-recipient resolution live here and nowhere else. */

export const INCIDENT_TYPES = ["outage", "degraded", "maintenance"] as const;

export const TYPE_LABELS: Record<string, string> = {
  outage: "Outage",
  degraded: "Degraded",
  maintenance: "Maintenance",
};

const COLOURS: Record<string, string> = {
  outage: "#B91C1C",
  degraded: "#B45309",
  maintenance: "#185FA5",
};
const GREEN = "#15803D";

/** Lower is worse. Unknown types sort last and are never "worst". */
export function typeRank(type: string): number {
  const i = (INCIDENT_TYPES as readonly string[]).indexOf(type);
  return i === -1 ? 99 : i;
}

/** The worst active type, or null when nothing is active. */
export function worstType(types: string[]): string | null {
  const known = types.filter((t) => typeRank(t) !== 99);
  if (known.length === 0) return null;
  return known.reduce((worst, t) => (typeRank(t) < typeRank(worst) ? t : worst));
}

export function dotColour(type: string | null): string {
  return type ? (COLOURS[type] ?? GREEN) : GREEN;
}

export function statusLabel(type: string | null): string {
  if (!type) return "All systems operational";
  if (type === "outage") return "Outage in progress";
  if (type === "degraded") return "Degraded service";
  return "Scheduled maintenance";
}

/** Email subject: resolution always reads as resolved, whatever the type. */
export function subjectFor(title: string, type: string, resolved: boolean): string {
  const prefix = resolved ? "Resolved" : (TYPE_LABELS[type] ?? "Update");
  return `[${prefix}] ${title}`;
}

export type Subscriber = {
  profileId: string;
  email: string;
  clientId: string | null;
  role: string;
};

/** Who gets emailed about this incident: subscribed client users only,
 *  narrowed to the targeted clients when the incident is client-scoped.
 *  Staff post incidents; they are never emailed about them. */
export function resolveRecipients(
  subs: Subscriber[],
  incident: { scope: string; clientIds: string[] },
): Subscriber[] {
  const targets = new Set(incident.clientIds);
  const seen = new Set<string>();
  const out: Subscriber[] = [];
  for (const s of subs) {
    if (s.role === "rocking_staff") continue;
    if (incident.scope === "clients" && (!s.clientId || !targets.has(s.clientId))) continue;
    if (seen.has(s.profileId)) continue;
    seen.add(s.profileId);
    out.push(s);
  }
  return out;
}
