import type { M365View } from "@/lib/views/m365";
import { Sparkline } from "./Sparkline";
import { Card, CardHeader } from "./ui/Card";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <div className={`text-2xl font-bold ${tone === "bad" ? "text-brand" : tone === "good" ? "text-good" : "text-ink"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[12.5px] text-muted">{label}</div>
    </div>
  );
}

export function M365View({ view }: { view: M365View }) {
  if (!view.connected) {
    return (
      <div className="rounded-lg border border-line bg-card px-4 py-6 text-sm text-muted">
        Microsoft 365 isn&apos;t connected for this client yet.
      </div>
    );
  }

  const sd = view.securityDefaultsOn;
  return (
    <div className="space-y-4">
      {/* Security posture */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
        <Card>
          <CardHeader title="MFA coverage trend" />
          <div className="px-4 py-3.5">
            <Sparkline values={view.trend} width={220} height={40} />
          </div>
        </Card>
      )}

      {/* Password-only (the headline finding) */}
      <Card>
        <CardHeader title="Licensed users without MFA" count={view.passwordOnly.length} />
        {view.passwordOnly.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-good">Every active licensed user has strong MFA. 🎉</p>
        ) : (
          <ul>
            {view.passwordOnly.map((u) => (
              <li key={u.upn} className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5 text-sm last:border-0">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-brand" />
                <span className="font-medium text-ink">{u.name}</span>
                <span className="text-muted">{u.upn}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Licenses */}
      <Card>
        <CardHeader title="License usage" />
        <table className="w-full text-sm">
          <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
            <tr>
              <th className="px-4 py-2.5 font-semibold">License</th>
              <th className="px-4 py-2.5 font-semibold">Used</th>
              <th className="px-4 py-2.5 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {view.licenses.map((l) => (
              <tr key={l.sku} className="border-b border-line-soft last:border-0">
                <td className="px-4 py-2.5 font-medium text-ink">{l.sku}</td>
                <td className={`px-4 py-2.5 ${l.maxed ? "font-semibold text-warn" : "text-muted"}`}>
                  {l.consumed ?? "—"}
                  {l.maxed ? " (full)" : ""}
                </td>
                <td className="px-4 py-2.5 text-muted">{l.total ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Unlicensed but enabled */}
      {view.unlicensedEnabled.length > 0 && (
        <Card>
          <CardHeader title="Enabled accounts without a license" count={view.unlicensedEnabled.length} />
          <div className="px-4 py-3.5">
            <p className="mb-2.5 text-xs text-muted">
              Shared mailboxes and resource accounts are expected here; unexpected ones may be stale.
            </p>
            <div className="flex flex-wrap gap-2">
              {view.unlicensedEnabled.slice(0, 60).map((u) => (
                <span key={u.upn} className="rounded bg-line-soft px-2 py-0.5 text-xs text-ink-3">
                  {u.name}
                </span>
              ))}
              {view.unlicensedEnabled.length > 60 && (
                <span className="text-xs text-faint">+{view.unlicensedEnabled.length - 60} more</span>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
