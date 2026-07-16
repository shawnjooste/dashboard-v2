import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getActivity, type ActivityGroup } from "@/lib/views/activity";
import { groupByDay } from "@/lib/activity-helpers";
import { Card, CardHeader, PageHeader } from "@/components/ui";

const GROUPS: { key: ActivityGroup | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "logins", label: "Logins" },
  { key: "views", label: "Views" },
  { key: "actions", label: "Actions" },
  { key: "changes", label: "Changes" },
  { key: "quotes", label: "Quotes" },
  { key: "emails", label: "Emails" },
  { key: "syncs", label: "Syncs" },
];
const DAY_OPTIONS = [1, 7, 30];
const fmtTime = (ts: string) => ts.slice(11, 16);

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; days?: string; client?: string }>;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const params = await searchParams;
  const group = (GROUPS.some((g) => g.key === params.group) ? params.group : "all") as ActivityGroup | "all";
  const days = DAY_OPTIONS.includes(Number(params.days)) ? Number(params.days) : 7;
  const clientFilter = params.client ?? "";

  const { items, capped } = await getActivity(days);
  const clientsInFeed = [...new Map(items.filter((i) => i.clientId).map((i) => [i.clientId!, i.clientName ?? ""])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const filtered = items
    .filter((i) => group === "all" || i.group === group)
    .filter((i) => !clientFilter || i.clientId === clientFilter);
  const dayGroups = groupByDay(filtered);
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ group, days: String(days), client: clientFilter, ...over });
    if (p.get("group") === "all") p.delete("group");
    if (!p.get("client")) p.delete("client");
    return `/admin/activity?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        subtitle="Everything happening across the portal — logins, what clients look at, changes, quotes and sync runs."
      />

      <div className="flex flex-wrap items-center gap-2">
        {GROUPS.map((g) => (
          <Link
            key={g.key}
            href={qs({ group: g.key })}
            className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${
              group === g.key ? "bg-ink text-white" : "bg-line-soft text-ink-3 hover:bg-line"
            }`}
          >
            {g.label}
          </Link>
        ))}
        <span className="mx-1 text-line">|</span>
        {DAY_OPTIONS.map((d) => (
          <Link
            key={d}
            href={qs({ days: String(d) })}
            className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${
              days === d ? "bg-ink text-white" : "bg-line-soft text-ink-3 hover:bg-line"
            }`}
          >
            {d === 1 ? "Today" : `${d} days`}
          </Link>
        ))}
        <form className="ml-auto" action="/admin/activity" method="get">
          <input type="hidden" name="group" value={group === "all" ? "" : group} />
          <input type="hidden" name="days" value={days} />
          <select
            name="client"
            defaultValue={clientFilter}
            className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none"
          >
            <option value="">All clients</option>
            {clientsInFeed.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button className="ml-2 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-black">
            Filter
          </button>
        </form>
      </div>

      {capped && (
        <p className="text-[13px] text-muted">Showing the most recent activity — narrow the window for a complete view.</p>
      )}

      {dayGroups.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">Nothing in this window yet.</p>
        </Card>
      ) : (
        dayGroups.map((g) => (
          <Card key={g.day}>
            <CardHeader title={g.day} count={g.items.length} />
            <ul>
              {g.items.map((item, i) => (
                <li key={i} className="flex items-baseline gap-3 border-b border-line-soft px-4 py-2.5 text-sm last:border-0">
                  <span className="shrink-0 font-mono text-xs text-faint">{fmtTime(item.at)}</span>
                  <span className="shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-3">
                    {item.group}
                  </span>
                  <span className="min-w-0 text-ink">
                    {item.actor && <span className="font-medium capitalize">{item.actor} </span>}
                    {item.clientName && <span className="text-muted">({item.clientName}) </span>}
                    {item.href ? (
                      <Link href={item.href} className="hover:text-brand">
                        {item.text}
                      </Link>
                    ) : (
                      item.text
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
