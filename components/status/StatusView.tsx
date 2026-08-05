import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getStatusPage, type StatusIncident } from "@/lib/views/status";
import { dotColour, statusLabel, TYPE_LABELS, worstType } from "@/lib/status-helpers";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { SubscribeToggle } from "./SubscribeToggle";
import { PostIncidentForm, IncidentControls } from "./StaffControls";

const fmt = (ts: string) => ts.replace("T", " ").slice(0, 16);

const TYPE_TONE: Record<string, string> = {
  outage: "bg-brand-tint text-brand",
  degraded: "bg-warn-tint text-warn-ink",
  maintenance: "bg-line-soft text-ink-2",
};

function UpdateList({ updates }: { updates: StatusIncident["updates"] }) {
  if (updates.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2.5 border-l-2 border-line-soft pl-3.5">
      {updates.map((u) => (
        <li key={u.id}>
          <p className="whitespace-pre-wrap text-[13.5px] text-ink">{u.body}</p>
          <p className="mt-0.5 text-xs text-faint">
            {u.isResolution && <span className="font-semibold text-good">Resolved · </span>}
            {fmt(u.createdAt)}
            {u.author ? <span className="capitalize"> · {u.author}</span> : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Who an incident affects. Staff see the client names; a client only ever
 *  learns that it's them — never which other companies are also down. */
function scopeLine(incident: StatusIncident, isStaff: boolean): string {
  if (incident.scope === "global") return "Affects all clients";
  if (!isStaff) return "Affects your account";
  return incident.clientNames.length ? `Affects ${incident.clientNames.join(", ")}` : "Affects selected clients";
}

/** The status page, shared by the client (/status) and staff (/admin/status)
 *  routes — the two differ only in which controls they get. */
export async function StatusView() {
  const me = await getCurrentProfile();
  const isStaff = me.authenticated && me.profile.role === "rocking_staff";
  const { active, history, subscribed } = await getStatusPage();

  let clients: { id: string; name: string }[] = [];
  if (isStaff) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("clients")
      .select("id, name")
      .eq("status", "active")
      .order("name");
    clients = data ?? [];
  }

  const worst = worstType(active.map((i) => i.type));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Status"
        subtitle={
          active.length === 0
            ? "Everything we monitor is running normally. Past incidents are kept below."
            : "What's affected right now, and what we're doing about it."
        }
        action={isStaff ? <PostIncidentForm clients={clients} /> : undefined}
      />

      {/* Current state */}
      <Card>
        <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3.5">
          <span
            className="h-[9px] w-[9px] shrink-0 rounded-full"
            style={{ background: dotColour(worst) }}
          />
          <span className="text-[15px] font-semibold text-ink">{statusLabel(worst)}</span>
          {active.length > 0 && (
            <span className="text-[13px] text-muted">
              {active.length} open {active.length === 1 ? "incident" : "incidents"}
            </span>
          )}
        </div>

        {active.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            No incidents are open. If something isn&rsquo;t working, raise a ticket and we&rsquo;ll look into it.
          </p>
        ) : (
          <ul>
            {active.map((i) => (
              <li key={i.id} className="border-b border-line-soft px-4 py-4 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${TYPE_TONE[i.type] ?? "bg-line-soft text-ink-3"}`}
                  >
                    {TYPE_LABELS[i.type] ?? i.type}
                  </span>
                  <span className="text-[15px] font-semibold text-ink">{i.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-faint">since {fmt(i.startedAt)}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-muted">{scopeLine(i, isStaff)}</p>
                <UpdateList updates={i.updates} />
                {isStaff && (
                  <div className="mt-3">
                    <IncidentControls incidentId={i.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!isStaff && (
        <Card>
          <div className="px-4 py-3.5">
            <SubscribeToggle initial={subscribed} />
          </div>
        </Card>
      )}

      {/* History — never deleted */}
      <Card>
        <CardHeader title="History" count={history.length} />
        {history.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing here yet — no incidents have been recorded.</p>
        ) : (
          <ul>
            {history.map((i) => (
              <li key={i.id} className="border-b border-line-soft px-4 py-3.5 last:border-0">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 list-none">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_TONE[i.type] ?? "bg-line-soft text-ink-3"}`}
                    >
                      {TYPE_LABELS[i.type] ?? i.type}
                    </span>
                    <span className="text-sm font-medium text-ink">{i.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-faint">
                      {fmt(i.startedAt)}
                      {i.resolvedAt ? ` → ${fmt(i.resolvedAt)}` : ""}
                    </span>
                  </summary>
                  <p className="mt-1.5 text-[12.5px] text-muted">{scopeLine(i, isStaff)}</p>
                  <UpdateList updates={i.updates} />
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
