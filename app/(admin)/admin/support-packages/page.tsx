import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getSupportPackages } from "@/lib/views/support-packages";
import { savePackage } from "@/lib/actions/support-packages";
import { fmtMinutes, monthKey, usedMinutesInMonth } from "@/lib/support-package-helpers";
import { getActiveServices, getAllBookings } from "@/lib/views/bookings";
import { saveServicePrice, markBookingCompleted, cancelBooking } from "@/lib/actions/bookings";
import { fmtRands, totalCents } from "@/lib/booking-helpers";
import { Card, CardHeader, PageHeader } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

export default async function SupportPackagesPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const supabase = await createClient();
  const key = monthKey(new Date());
  const [packages, clientsRes, entriesRes, services, bookings] = await Promise.all([
    getSupportPackages(),
    supabase.from("clients").select("id, name, support_package_id, support_plan_label").order("name"),
    supabase.from("support_time_entries").select("client_id, occurred_on, minutes").gte("occurred_on", `${key}-01`),
    getActiveServices(),
    getAllBookings(),
  ]);
  const clients = clientsRes.data ?? [];
  const entries = entriesRes.data ?? [];
  const pkgById = new Map(packages.map((p) => [p.id, p]));
  // Clients on a paid tier, plus any client with logged time this month.
  const activeIds = new Set(entries.map((e) => e.client_id));
  const rows = clients
    .filter((c) => (c.support_package_id && !pkgById.get(c.support_package_id)?.isDefault) || activeIds.has(c.id))
    .map((c) => {
      const pkg = (c.support_package_id && pkgById.get(c.support_package_id)) || packages.find((p) => p.isDefault) || null;
      const used = usedMinutesInMonth(entries.filter((e) => e.client_id === c.id), key);
      return { id: c.id, name: c.name, pkg, label: c.support_plan_label, used };
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support packages"
        subtitle="The tiers clients can be on, and who's burning hours this month. Allowances here are data — edit freely."
      />

      <Card>
        <CardHeader title="Packages" count={packages.length} />
        {packages.map((p) => (
          <form key={p.id} action={savePackage} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5 last:border-0">
            <input type="hidden" name="id" value={p.id} />
            <span className="w-28 shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-center text-[11px] font-medium text-ink-3">{p.key}</span>
            <input name="name" defaultValue={p.name} className={`${FIELD} w-40`} />
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <input name="included_hours" type="number" step="0.5" min="0" defaultValue={p.includedMinutes / 60} className={`${FIELD} w-20`} />
              hrs/month
            </label>
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <input name="sla_hours" type="number" min="0" defaultValue={p.slaHours ?? ""} placeholder="—" className={`${FIELD} w-20`} />
              hr response
            </label>
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <input type="checkbox" name="has_chat" defaultChecked={p.hasChat} /> chat
            </label>
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <input type="checkbox" name="remote_included" defaultChecked={p.remoteIncluded} /> remote incl.
            </label>
            <button className="ml-auto rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
              Save
            </button>
          </form>
        ))}
      </Card>

      <Card>
        <CardHeader title={`This month (${key})`} count={rows.length} />
        {rows.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted">No clients on paid tiers or logged time yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Package</th>
                <th className="px-4 py-2.5 font-semibold">Used</th>
                <th className="px-4 py-2.5 font-semibold">Included</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const over = r.pkg && r.pkg.includedMinutes > 0 && r.used > r.pkg.includedMinutes;
                return (
                  <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                    <td className="px-4 py-2.5 font-medium text-ink">{r.name}</td>
                    <td className="px-4 py-2.5 text-ink-2">
                      {r.pkg?.name ?? "—"}
                      {r.label ? <span className="text-muted"> · {r.label}</span> : null}
                    </td>
                    <td className={`px-4 py-2.5 ${over ? "font-semibold text-brand" : "text-ink-2"}`}>{fmtMinutes(r.used)}</td>
                    <td className="px-4 py-2.5 text-muted">{r.pkg && r.pkg.includedMinutes > 0 ? fmtMinutes(r.pkg.includedMinutes) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <CardHeader title="Paid session prices" count={services.length} />
        {services.map((s) => (
          <form
            key={s.id}
            action={saveServicePrice}
            className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5 last:border-0"
          >
            <input type="hidden" name="id" value={s.id} />
            <span className="w-48 text-sm font-medium text-ink">{s.name}</span>
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              R
              <input
                name="price_rands"
                type="number"
                min="1"
                step="50"
                defaultValue={s.priceCents / 100}
                className={`${FIELD} w-28`}
              />
              ex VAT / hour
            </label>
            <span className="text-xs text-muted">({fmtRands(totalCents(s.priceCents))} incl)</span>
            <button className="ml-auto rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
              Save
            </button>
          </form>
        ))}
      </Card>

      <Card>
        <CardHeader title="Bookings" count={bookings.length} />
        {bookings.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted">No bookings yet.</p>
        ) : (
          <ul>
            {bookings.map((b) => {
              const complete = markBookingCompleted.bind(null, b.id);
              const cancel = cancelBooking.bind(null, b.id);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-2.5 border-b border-line-soft px-4 py-3 last:border-0">
                  <span className="shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-3">
                    {b.status === "pending_payment" ? "pending" : b.status}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {b.clientName ?? "—"} · {b.serviceName} · {b.slotLabel}
                    </p>
                    <p className="truncate text-xs text-faint">
                      {fmtRands(b.amountCents + b.vatCents)} incl
                      {b.freescoutNumber ? ` · ticket #${b.freescoutNumber}` : ""}
                      {b.note ? ` · ${b.note}` : ""}
                    </p>
                  </div>
                  {b.status === "paid" && (
                    <form action={complete}>
                      <button className="text-xs font-semibold text-good">Mark completed</button>
                    </form>
                  )}
                  {(b.status === "paid" || b.status === "pending_payment") && (
                    <form action={cancel}>
                      <button
                        className="text-xs text-faint hover:text-brand"
                        title="Cancel (refunds are manual — Paystack dashboard)"
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
