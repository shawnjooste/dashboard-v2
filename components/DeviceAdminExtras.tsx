import type { DeviceExtras, DeviceMeta } from "@/lib/views/devices";
import { Card, CardHeader } from "./ui/Card";

/** Staff-only device enrichment: network adapters, software inventory, Datto UDFs.
 *  Never rendered on the client-facing device page. */
export function DeviceAdminExtras({ meta, extras }: { meta: DeviceMeta; extras: DeviceExtras }) {
  const { nics, software, udfs } = extras;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Network & hardware" />
        <dl className="space-y-1 px-4 py-3.5 text-sm">
          <Row label="Domain / workgroup" value={meta.domain ?? "—"} />
          <Row label="BIOS" value={meta.biosVersion ?? "—"} />
        </dl>
        {nics.length > 0 && (
          <table className="w-full border-t border-line-soft text-sm">
            <thead className="text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Adapter</th>
                <th className="px-4 py-2.5 font-semibold">IPv4</th>
                <th className="px-4 py-2.5 font-semibold">MAC</th>
              </tr>
            </thead>
            <tbody>
              {nics.map((n, i) => (
                <tr key={i} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5 text-ink-2">{n.label ?? n.nicType ?? "—"}</td>
                  <td className="px-4 py-2.5 font-medium text-ink">{n.ipv4 ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{n.mac ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {udfs.length > 0 && (
        <Card>
          <CardHeader title="Custom fields (Datto)" count={udfs.length} />
          <dl className="space-y-1.5 px-4 py-3.5 text-sm">
            {udfs.map((u) => (
              <div key={u.slot} className="flex flex-col gap-0.5 border-b border-line-soft pb-1.5 last:border-0 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="shrink-0 text-muted">{u.slot}</dt>
                <dd className="break-words text-ink-2 sm:text-right">{u.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <Card>
        <CardHeader title="Installed software" count={software.length} />
        {software.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted">No software inventory on record.</p>
        ) : (
          <details>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-2 hover:bg-line-soft">
              Show {software.length} applications
            </summary>
            <ul className="max-h-80 overflow-y-auto border-t border-line-soft">
              {software.map((s, i) => (
                <li key={i} className="flex justify-between gap-4 border-b border-line-soft px-4 py-1.5 text-sm last:border-0">
                  <span className="text-ink-2">{s.name}</span>
                  <span className="shrink-0 text-xs text-faint">{s.version ?? ""}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink-2">{value}</dd>
    </div>
  );
}
