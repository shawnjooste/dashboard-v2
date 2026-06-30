import { getDeviceChanges } from "@/lib/views/devices";
import { Card, CardHeader } from "@/components/ui";
import { addDeviceChange, deleteDeviceChange } from "./actions";

const CATEGORIES = ["disk", "memory", "cpu", "hardware", "software", "config", "other"] as const;
const fmt = (ts: string) => ts.replace("T", " ").slice(0, 16);

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

/** Manual record of work we've done on a device — things Datto won't reflect. Staff-only. */
export async function DeviceChangeLog({ deviceId }: { deviceId: string }) {
  const changes = await getDeviceChanges(deviceId);
  const add = addDeviceChange.bind(null, deviceId);

  return (
    <Card>
      <CardHeader title="Change log" count={changes.length} />

      <form action={add} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5">
        <select name="category" defaultValue="disk" className={FIELD}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
        <input
          name="note"
          required
          placeholder="e.g. Increased C: by 10 GB (50 → 60 GB)"
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
          Add
        </button>
      </form>

      {changes.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">
          No changes recorded yet — log hardware or config work here so it&rsquo;s on the record even when Datto doesn&rsquo;t show it.
        </p>
      ) : (
        <ul>
          {changes.map((c) => {
            const remove = deleteDeviceChange.bind(null, c.id, deviceId);
            return (
              <li key={c.id} className="flex items-start gap-2.5 border-b border-line-soft px-4 py-3 last:border-0">
                <span className="mt-0.5 shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-3">
                  {c.category}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-sm text-ink">{c.note}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {fmt(c.createdAt)}
                    {c.author ? <span className="capitalize"> · {c.author}</span> : ""}
                  </p>
                </div>
                <form action={remove} className="shrink-0">
                  <button className="text-xs text-faint hover:text-brand" title="Delete entry">
                    Remove
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
