import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getSupportPackages } from "@/lib/views/support-packages";
import { bulkAssignPackages } from "@/lib/actions/support-packages";
import { Card, CardHeader, PageHeader } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-2.5 py-1 text-[13px] text-ink outline-none focus:border-faint";

/** One pass over every client to set their support tier. Deliberately a plain
 *  form with a single Save: the job is "go through all my customers", not
 *  "edit one client", and a save-per-row would mean 180 round trips. */
export default async function AssignTiersPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string; paid?: string }>;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");
  const saved = await searchParams;

  const service = createServiceClient();
  const [packages, { data: clients }] = await Promise.all([
    getSupportPackages(),
    // Active clients only. Archiving a client is how you say "we don't work
    // with them any more" — they shouldn't turn up in a list whose whole
    // purpose is deciding what each customer pays for support.
    service
      .from("clients")
      .select("id, name, support_package_id, support_plan_label")
      .eq("status", "active")
      .order("name"),
  ]);
  const rows = clients ?? [];
  const defaultPkg = packages.find((p) => p.isDefault);

  const counts = packages.map((p) => ({
    name: p.name,
    n: rows.filter((c) =>
      c.support_package_id ? c.support_package_id === p.id : p.isDefault,
    ).length,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href="/admin/support-packages" className="hover:text-ink">
            ← Support packages
          </Link>
        }
        title="Assign support tiers"
        subtitle="Set every client's tier in one pass. Unassigned clients sit on the default tier until you change them."
      />

      {saved.changed != null && (
        <div className="rounded-lg bg-warn-tint px-4 py-3 text-[13px] text-warn-ink">
          Saved — <strong>{saved.changed}</strong> client{saved.changed === "1" ? "" : "s"} updated,{" "}
          <strong>{saved.paid ?? 0}</strong> now on a paid tier. The tiers below are what&apos;s stored.
        </div>
      )}

      <form action={bulkAssignPackages}>
        <Card>
          <CardHeader
            title="Clients"
            count={rows.length}
            action={
              <button className="rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark">
                Save changes
              </button>
            }
          />
          <p className="border-b border-line-soft px-4 py-2.5 text-[13px] text-muted">
            {counts.map((c) => `${c.n} ${c.name}`).join(" · ")}
          </p>
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Tier</th>
                <th className="px-4 py-2.5 font-semibold">Plan label (optional)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const assigned = c.support_package_id ?? defaultPkg?.id ?? "";
                const onPaid = !!c.support_package_id && c.support_package_id !== defaultPkg?.id;
                return (
                  <tr key={c.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                    <td className="px-4 py-2">
                      <span className={onPaid ? "font-semibold text-ink" : "text-ink-2"}>{c.name}</span>
                    </td>
                    <td className="px-4 py-2">
                      <select name={`pkg_${c.id}`} defaultValue={assigned} className={FIELD}>
                        {packages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        name={`label_${c.id}`}
                        defaultValue={c.support_plan_label ?? ""}
                        placeholder='e.g. "Managed IT bundle"'
                        className={`${FIELD} w-full max-w-xs`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-line-soft px-4 py-3.5">
            <button className="rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark">
              Save changes
            </button>
          </div>
        </Card>
      </form>
    </div>
  );
}
