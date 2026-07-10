import { createClient } from "@/lib/supabase/server";
import { setDeviceDisposition } from "@/lib/actions/device-disposition";
import { Card, CardHeader } from "@/components/ui";
import { DispositionTag, DISPOSITION_LABELS } from "./DispositionTag";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

/** Portal-owned lifecycle status for a device (not synced from Datto).
 *  Editable by Rocking staff and the client's managers; the RPC enforces it. */
export async function DeviceDisposition({ deviceId, canEdit }: { deviceId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data: d } = await supabase
    .from("devices")
    .select("disposition, disposition_note, disposition_updated_at")
    .eq("id", deviceId)
    .maybeSingle();
  if (!d) return null;

  // Nothing noteworthy and no rights to change it — don't render an empty card.
  if (!canEdit && d.disposition === "in_use" && !d.disposition_note) return null;

  const save = setDeviceDisposition.bind(null, deviceId);
  const updated = d.disposition_updated_at ? d.disposition_updated_at.replace("T", " ").slice(0, 16) : null;

  return (
    <Card>
      <CardHeader title="Status" />
      <div className="px-4 py-3.5">
        {canEdit ? (
          <form action={save} className="flex flex-wrap items-center gap-2">
            <select name="disposition" defaultValue={d.disposition} className={FIELD}>
              {Object.entries(DISPOSITION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              name="note"
              defaultValue={d.disposition_note ?? ""}
              placeholder="Note (optional), e.g. Awaiting charger"
              className={`${FIELD} min-w-0 flex-1`}
            />
            <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
              Save
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <DispositionTag disposition={d.disposition} />
            {d.disposition_note && <span className="text-sm text-ink-2">{d.disposition_note}</span>}
          </div>
        )}
        {updated && <p className="mt-2 text-xs text-faint">Updated {updated}</p>}
      </div>
    </Card>
  );
}
