import Link from "next/link";
import { getM365Overview } from "@/lib/views/m365";
import { Card, PageHeader } from "@/components/ui";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <div className={`text-2xl font-bold text-ink ${tone === "bad" ? "text-warn" : ""}`}>
        {value}
      </div>
      <div className="text-[12.5px] text-muted">{label}</div>
    </div>
  );
}

export default async function AdminM365Page() {
  const { tenants, totals } = await getM365Overview();

  return (
    <div className="space-y-6">
      <PageHeader title="Microsoft 365" />

      {tenants.length === 0 ? (
        <p className="text-muted">
          No Microsoft 365 tenants connected yet. Connect one with
          <code className="mx-1 rounded bg-canvas px-1 text-ink-2">scripts/m365-connect.mjs</code>.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Tenants" value={String(totals.tenants)} />
            <Stat label="Licensed users" value={String(totals.licensedUsers)} />
            <Stat
              label="MFA coverage"
              value={totals.mfaCoverage === null ? "—" : `${totals.mfaCoverage}%`}
              tone={totals.mfaCoverage !== null && totals.mfaCoverage < 100 ? "bad" : "good"}
            />
            <Stat label="Without MFA" value={String(totals.withoutMfa)} tone={totals.withoutMfa ? "bad" : "good"} />
            <Stat label="Security defaults off" value={String(totals.securityDefaultsOff)} tone={totals.securityDefaultsOff ? "bad" : "good"} />
          </div>

          <Card>
            <table className="w-full text-sm">
              <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Client</th>
                  <th className="px-4 py-2.5 font-semibold">Licensed</th>
                  <th className="px-4 py-2.5 font-semibold">MFA</th>
                  <th className="px-4 py-2.5 font-semibold">Without MFA</th>
                  <th className="px-4 py-2.5 font-semibold">Security defaults</th>
                  <th className="px-4 py-2.5 font-semibold">Last synced</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.clientId} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/admin/clients/${t.clientId}/m365`} className="text-ink hover:text-brand">
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{t.licensedUsers}</td>
                    <td className={`px-4 py-2.5 ${t.mfaCoverage !== null && t.mfaCoverage < 100 ? "text-brand" : "text-ink-2"}`}>
                      {t.mfaCoverage === null ? "—" : `${t.mfaCoverage}%`}
                    </td>
                    <td className={`px-4 py-2.5 ${t.withoutMfa ? "text-warn" : "text-ink-2"}`}>{t.withoutMfa}</td>
                    <td className={`px-4 py-2.5 ${t.securityDefaultsOn === false ? "text-warn" : "text-ink-2"}`}>
                      {t.securityDefaultsOn === null ? "—" : t.securityDefaultsOn ? "On" : "Off"}
                    </td>
                    <td className="px-4 py-2.5 text-faint">{t.lastPullAt ? t.lastPullAt.slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
