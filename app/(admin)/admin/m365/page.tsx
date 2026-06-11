import Link from "next/link";
import { getM365Overview } from "@/lib/views/m365";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className={`text-2xl font-semibold ${tone === "bad" ? "text-red-600" : tone === "good" ? "text-green-600" : ""}`}>
        {value}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

export default async function AdminM365Page() {
  const { tenants, totals } = await getM365Overview();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Microsoft 365</h1>

      {tenants.length === 0 ? (
        <p className="text-gray-500">
          No Microsoft 365 tenants connected yet. Connect one with
          <code className="mx-1 rounded bg-gray-100 px-1">scripts/m365-connect.mjs</code>.
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

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Licensed</th>
                  <th className="px-3 py-2">MFA</th>
                  <th className="px-3 py-2">Without MFA</th>
                  <th className="px-3 py-2">Security defaults</th>
                  <th className="px-3 py-2">Last synced</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.clientId} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/admin/clients/${t.clientId}/m365`} className="text-blue-600 hover:underline">
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{t.licensedUsers}</td>
                    <td className={`px-3 py-2 ${t.mfaCoverage !== null && t.mfaCoverage < 100 ? "text-red-600" : "text-gray-600"}`}>
                      {t.mfaCoverage === null ? "—" : `${t.mfaCoverage}%`}
                    </td>
                    <td className={`px-3 py-2 ${t.withoutMfa ? "text-red-600" : "text-gray-600"}`}>{t.withoutMfa}</td>
                    <td className={`px-3 py-2 ${t.securityDefaultsOn === false ? "text-red-600" : "text-gray-600"}`}>
                      {t.securityDefaultsOn === null ? "—" : t.securityDefaultsOn ? "On" : "Off"}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{t.lastPullAt ? t.lastPullAt.slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
