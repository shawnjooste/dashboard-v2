import { getConnectivityLines } from "@/lib/views/connectivity";
import { addLine, setLineActive, deleteLine } from "@/lib/actions/connectivity";
import { KIND_LABELS } from "@/lib/connectivity-helpers";
import { Card, CardHeader, StatusPill } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";
const KINDS = ["fibre", "wireless", "lte", "other"] as const;

/** Staff-only: the client's connectivity lines — the portal is the source of
 *  record. Live status shown so staff see what the client sees. */
export async function ConnectivitySection({ clientId }: { clientId: string }) {
  const lines = await getConnectivityLines(clientId, { includeInactive: true });
  const add = addLine.bind(null, clientId);

  return (
    <Card>
      <CardHeader title="Connectivity" count={lines.filter((l) => l.isActive).length} />

      <form action={add} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5">
        <input name="label" required placeholder="Label, e.g. Main office fibre" className={`${FIELD} w-52`} />
        <select name="kind" defaultValue="fibre" className={FIELD}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <input name="provider" placeholder="Provider" className={`${FIELD} w-32`} />
        <input name="download_mbps" type="number" min="1" placeholder="Down" className={`${FIELD} w-20`} />
        <input name="upload_mbps" type="number" min="1" placeholder="Up" className={`${FIELD} w-20`} />
        <input name="librenms_device_id" type="number" min="1" placeholder="NMS id" className={`${FIELD} w-24`} />
        <input name="notes" placeholder="Notes" className={`${FIELD} min-w-0 flex-1`} />
        <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
          Add line
        </button>
      </form>

      {lines.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No lines recorded for this client.</p>
      ) : (
        <ul>
          {lines.map((l) => {
            const toggle = setLineActive.bind(null, l.id, clientId, !l.isActive);
            const remove = deleteLine.bind(null, l.id, clientId);
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2.5 border-b border-line-soft px-4 py-3 last:border-0">
                <span className={`font-medium ${l.isActive ? "text-ink" : "text-faint line-through"}`}>{l.label}</span>
                {l.status &&
                  (l.status.up === true ? (
                    <StatusPill tone="good" label="Online" />
                  ) : l.status.up === false ? (
                    <StatusPill tone="bad" label="Down" />
                  ) : (
                    <StatusPill tone="warn" label="?" />
                  ))}
                <span className="text-[13px] text-muted">
                  {[KIND_LABELS[l.kind] ?? l.kind, l.speed, l.provider, l.librenmsDeviceId ? `NMS ${l.librenmsDeviceId}` : "unmapped"]
                    .filter(Boolean)
                    .join(" · ")}
                  {l.notes ? ` · ${l.notes}` : ""}
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
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
