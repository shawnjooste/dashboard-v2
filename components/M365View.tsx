import type { M365View } from "@/lib/views/m365";
import { Sparkline } from "./Sparkline";

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

export function M365View({ view }: { view: M365View }) {
  if (!view.connected) {
    return <p className="text-gray-500">Microsoft 365 isn&apos;t connected for this client yet.</p>;
  }

  const sd = view.securityDefaultsOn;
  return (
    <div className="space-y-8">
      {/* Security posture */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active licensed users" value={String(view.activeLicensed)} />
        <Stat
          label="MFA coverage"
          value={view.mfaCoverage === null ? "—" : `${view.mfaCoverage}%`}
          tone={view.mfaCoverage !== null && view.mfaCoverage < 100 ? "bad" : "good"}
        />
        <Stat
          label="Security defaults"
          value={sd === null ? "—" : sd ? "On" : "Off"}
          tone={sd === false ? "bad" : sd ? "good" : undefined}
        />
        <Stat
          label="Secure score"
          value={view.secureScore === null ? "—" : `${Math.round(view.secureScore)}${view.secureScoreMax ? `/${Math.round(view.secureScoreMax)}` : ""}`}
        />
      </div>

      {view.trend.length > 1 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase text-gray-500">MFA coverage trend</h3>
          <Sparkline values={view.trend} width={220} height={40} />
        </div>
      )}

      {/* Password-only (the headline finding) */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">
          Licensed users without MFA ({view.passwordOnly.length})
        </h3>
        {view.passwordOnly.length === 0 ? (
          <p className="text-sm text-green-700">Every active licensed user has strong MFA. 🎉</p>
        ) : (
          <ul className="space-y-1">
            {view.passwordOnly.map((u) => (
              <li key={u.upn} className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm">
                <span className="font-medium">{u.name}</span>{" "}
                <span className="text-gray-500">{u.upn}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Licenses */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">License usage</h3>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">License</th>
                <th className="px-3 py-2">Used</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {view.licenses.map((l) => (
                <tr key={l.sku} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2 font-medium">{l.sku}</td>
                  <td className={`px-3 py-2 ${l.maxed ? "font-semibold text-amber-600" : "text-gray-600"}`}>
                    {l.consumed ?? "—"}
                    {l.maxed ? " (full)" : ""}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{l.total ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Unlicensed but enabled */}
      {view.unlicensedEnabled.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">
            Enabled accounts without a license ({view.unlicensedEnabled.length})
          </h3>
          <p className="mb-2 text-xs text-gray-500">
            Shared mailboxes and resource accounts are expected here; unexpected ones may be stale.
          </p>
          <div className="flex flex-wrap gap-2">
            {view.unlicensedEnabled.slice(0, 60).map((u) => (
              <span key={u.upn} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {u.name}
              </span>
            ))}
            {view.unlicensedEnabled.length > 60 && (
              <span className="text-xs text-gray-400">+{view.unlicensedEnabled.length - 60} more</span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
