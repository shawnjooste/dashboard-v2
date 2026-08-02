import type { ConnectivityLine } from "@/lib/views/connectivity";
import { getConnectivityLines } from "@/lib/views/connectivity";
import { addLine, updateLine, setLineActive, deleteLine, addHop, deleteHop, moveHop } from "@/lib/actions/connectivity";
import {
  KIND_LABELS,
  CONN_TYPE_LABELS,
  CONN_TYPES,
  isStale,
  linkState,
  HOP_KINDS,
  HOP_KIND_LABELS,
  HOP_KIND_ICONS,
} from "@/lib/connectivity-helpers";
import { Card, CardHeader, StatusPill } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";
const KINDS = ["fibre", "wireless", "lte", "other"] as const;
const fmtWhen = (iso: string) => iso.replace("T", " ").slice(0, 16);

/** The settings inputs shared by the add and edit forms. `line` prefills them
 *  on edit; the password is always blank (blank = keep the stored one). */
function LineFields({ line }: { line?: ConnectivityLine }) {
  return (
    <>
      <input name="label" required defaultValue={line?.label} placeholder="Label, e.g. Main office fibre" className={`${FIELD} w-52`} />
      <select name="kind" defaultValue={line?.kind ?? "fibre"} className={FIELD}>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <input name="provider" defaultValue={line?.provider ?? ""} placeholder="Provider" className={`${FIELD} w-32`} />
      <input name="download_mbps" type="number" min="1" defaultValue={line?.downloadMbps ?? ""} placeholder="Down" className={`${FIELD} w-20`} />
      <input name="upload_mbps" type="number" min="1" defaultValue={line?.uploadMbps ?? ""} placeholder="Up" className={`${FIELD} w-20`} />
      <input name="librenms_device_id" type="number" min="1" defaultValue={line?.librenmsDeviceId ?? ""} placeholder="NMS id" className={`${FIELD} w-24`} />
      <input name="description" defaultValue={line?.description ?? ""} placeholder="Description of the link" className={`${FIELD} min-w-0 flex-1`} />
      <select name="conn_type" defaultValue={line?.connType ?? "dhcp"} className={FIELD}>
        {CONN_TYPES.map((t) => (
          <option key={t} value={t}>
            {CONN_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <input name="pppoe_username" defaultValue={line?.pppoeUsername ?? ""} placeholder="PPPoE user" className={`${FIELD} w-36`} />
      <input
        name="pppoe_password"
        type="password"
        autoComplete="new-password"
        placeholder={line?.hasSecret ? "leave blank to keep" : "PPPoE password"}
        className={`${FIELD} w-40`}
      />
      <input name="ip_address" defaultValue={line?.ipAddress ?? ""} placeholder="IP" className={`${FIELD} w-32`} />
      <input name="subnet_mask" defaultValue={line?.subnetMask ?? ""} placeholder="Mask" className={`${FIELD} w-32`} />
      <input name="gateway" defaultValue={line?.gateway ?? ""} placeholder="Gateway" className={`${FIELD} w-32`} />
      <input name="dns_servers" defaultValue={line?.dnsServers ?? ""} placeholder="DNS (comma-separated)" className={`${FIELD} w-44`} />
      <input name="vlan" type="number" min="1" defaultValue={line?.vlan ?? ""} placeholder="VLAN" className={`${FIELD} w-20`} />
      <input name="notes" defaultValue={line?.notes ?? ""} placeholder="Internal notes" className={`${FIELD} min-w-0 flex-1`} />
    </>
  );
}

/** Live status summary shown to staff — the same rules the client card uses. */
function StatusBits({ line, nowMs }: { line: ConnectivityLine; nowMs: number }) {
  if (line.librenmsDeviceId == null)
    return <span className="rounded bg-line-soft px-1.5 py-0.5 text-[11px] text-ink-3">unmapped</span>;
  const state = linkState({ up: line.lastUp, lossPct: line.lossPct, lastCheckedAt: line.lastCheckedAt }, nowMs);
  if (state === "stale")
    return <StatusPill tone="warn" label={line.lastCheckedAt ? `Last checked ${fmtWhen(line.lastCheckedAt)}` : "Not checked yet"} />;
  if (state === "up")
    return <StatusPill tone="good" label={`Online${line.latencyMs != null ? ` · ${line.latencyMs.toFixed(1)} ms` : ""}`} />;
  if (state === "degraded") return <StatusPill tone="warn" label={`Degraded · ${line.lossPct}% loss`} />;
  if (state === "down")
    return <StatusPill tone="bad" label={line.downSince ? `Down since ${fmtWhen(line.downSince)}` : "Not responding"} />;
  return <StatusPill tone="warn" label="Status unavailable" />;
}

/** The ordered hops that make up a line's path, editable in place. Hops with
 *  an NMS id are polled by the same 5-minute pull as the lines themselves. */
function PathEditor({ line, clientId, nowMs }: { line: ConnectivityLine; clientId: string; nowMs: number }) {
  const add = addHop.bind(null, line.id, clientId);
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-faint hover:text-ink">
        Path ({line.hops.length} hop{line.hops.length === 1 ? "" : "s"})
      </summary>

      {line.hops.length > 0 && (
        <ol className="mt-2 space-y-1">
          {line.hops.map((h, i) => {
            const up = moveHop.bind(null, h.id, clientId, "up");
            const down = moveHop.bind(null, h.id, clientId, "down");
            const remove = deleteHop.bind(null, h.id, clientId);
            const live =
              h.librenmsDeviceId == null
                ? "unmonitored"
                : isStale(h.lastCheckedAt, nowMs)
                  ? "no reading"
                  : h.lastUp === true
                    ? `up${h.latencyMs != null ? ` · ${h.latencyMs.toFixed(1)} ms` : ""}`
                    : h.lastUp === false
                      ? "DOWN"
                      : "no reading";
            return (
              <li key={h.id} className="flex items-center gap-2 text-[13px]">
                <span className="w-5 shrink-0 text-right text-faint">{i + 1}.</span>
                <span className="shrink-0">{HOP_KIND_ICONS[h.kind] ?? "●"}</span>
                <span className="font-medium text-ink">{h.label}</span>
                <span className="text-muted">
                  {HOP_KIND_LABELS[h.kind] ?? h.kind}
                  {h.librenmsDeviceId ? ` · NMS ${h.librenmsDeviceId}` : ""} · {live}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <form action={up}>
                    <button className="text-xs text-faint hover:text-ink" title="Move earlier">
                      ↑
                    </button>
                  </form>
                  <form action={down}>
                    <button className="text-xs text-faint hover:text-ink" title="Move later">
                      ↓
                    </button>
                  </form>
                  <form action={remove}>
                    <button className="text-xs text-faint hover:text-brand" title="Remove hop">
                      ✕
                    </button>
                  </form>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <form action={add} className="mt-2 flex flex-wrap items-center gap-2">
        <input name="hop_label" required placeholder="Hop label, e.g. Silverberg edge" className={`${FIELD} w-52`} />
        <select name="hop_kind" defaultValue="core" className={FIELD}>
          {HOP_KINDS.map((k) => (
            <option key={k} value={k}>
              {HOP_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <input name="hop_librenms_device_id" type="number" min="1" placeholder="NMS id" className={`${FIELD} w-24`} />
        <button className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
          Add hop
        </button>
      </form>
    </details>
  );
}

/** Staff-only: the client's connectivity lines — the portal is the source of
 *  record. Live status comes from the 5-minute pull running on Vision. */
export async function ConnectivitySection({ clientId }: { clientId: string }) {
  const lines = await getConnectivityLines(clientId, { includeInactive: true });
  const add = addLine.bind(null, clientId);
  const nowMs = Date.now();

  return (
    <Card>
      <CardHeader title="Connectivity" count={lines.filter((l) => l.isActive).length} />

      <details className="border-b border-line-soft">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold text-ink-2 hover:text-ink">
          + Add a line
        </summary>
        <form action={add} className="flex flex-wrap items-center gap-2 px-4 pb-3.5">
          <LineFields />
          <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
            Add line
          </button>
        </form>
      </details>

      {lines.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No lines recorded for this client.</p>
      ) : (
        <ul>
          {lines.map((l) => {
            const toggle = setLineActive.bind(null, l.id, clientId, !l.isActive);
            const remove = deleteLine.bind(null, l.id, clientId);
            const edit = updateLine.bind(null, l.id, clientId);
            return (
              <li key={l.id} className="border-b border-line-soft px-4 py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className={`font-medium ${l.isActive ? "text-ink" : "text-faint line-through"}`}>{l.label}</span>
                  <StatusBits line={l} nowMs={nowMs} />
                  <span className="text-[13px] text-muted">
                    {[
                      KIND_LABELS[l.kind] ?? l.kind,
                      l.speed,
                      l.provider,
                      CONN_TYPE_LABELS[l.connType] ?? l.connType,
                      l.librenmsDeviceId ? `NMS ${l.librenmsDeviceId}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-3">
                    <form action={toggle}>
                      <button className="text-xs text-faint hover:text-ink" title={l.isActive ? "Retire line" : "Reactivate line"}>
                        {l.isActive ? "Retire" : "Reactivate"}
                      </button>
                    </form>
                    {!l.isActive && (
                      <form action={remove}>
                        <button className="text-xs text-faint hover:text-brand" title="Delete permanently">
                          Delete
                        </button>
                      </form>
                    )}
                  </span>
                </div>
                <PathEditor line={l} clientId={clientId} nowMs={nowMs} />
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-faint hover:text-ink">Edit</summary>
                  <form action={edit} className="mt-2 flex flex-wrap items-center gap-2">
                    <LineFields line={l} />
                    <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
                      Save
                    </button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
