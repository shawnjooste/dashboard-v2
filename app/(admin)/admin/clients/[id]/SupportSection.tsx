import { getSupportPackages, getSupportStatus, getTimeEntries } from "@/lib/views/support-packages";
import { assignClientPackage, addTimeEntry, deleteTimeEntry } from "@/lib/actions/support-packages";
import { fmtMinutes, monthKey } from "@/lib/support-package-helpers";
import { Card, CardHeader } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";
const WORK_TYPES = ["ticket", "remote", "onsite", "other"] as const;

/** Staff-only: this client's package, plan label, and the month's time log. */
export async function SupportSection({ clientId }: { clientId: string }) {
  const key = monthKey(new Date());
  const [packages, status, entries] = await Promise.all([
    getSupportPackages(),
    getSupportStatus(clientId),
    getTimeEntries(clientId, key),
  ]);
  const assign = assignClientPackage.bind(null, clientId);
  const add = addTimeEntry.bind(null, clientId);
  const included = status.pkg?.includedMinutes ?? 0;

  return (
    <Card>
      <CardHeader
        title="Support"
        count={included > 0 ? `${fmtMinutes(status.usedMinutes)} of ${fmtMinutes(included)} used` : fmtMinutes(status.usedMinutes)}
      />

      <form action={assign} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5">
        <select name="package_id" defaultValue={status.pkg?.id ?? ""} className={FIELD}>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          name="plan_label"
          defaultValue={status.planLabel ?? ""}
          placeholder='Plan label (optional), e.g. "Managed IT bundle"'
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
          Save
        </button>
      </form>

      <form action={add} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5">
        <input name="minutes" type="number" min="1" required placeholder="Minutes" className={`${FIELD} w-24`} />
        <select name="work_type" defaultValue="ticket" className={FIELD}>
          {WORK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <input name="occurred_on" type="date" className={FIELD} />
        <input name="freescout_number" type="number" placeholder="Ticket #" className={`${FIELD} w-28`} />
        <input name="note" placeholder="What was done?" className={`${FIELD} min-w-0 flex-1`} />
        <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
          Log time
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No time logged this month.</p>
      ) : (
        <ul>
          {entries.map((e) => {
            const remove = deleteTimeEntry.bind(null, e.id, clientId);
            return (
              <li key={e.id} className="flex items-start gap-2.5 border-b border-line-soft px-4 py-3 last:border-0">
                <span className="mt-0.5 w-16 shrink-0 text-right font-medium text-ink">{fmtMinutes(e.minutes)}</span>
                <span className="mt-0.5 shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-3">
                  {e.workType}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{e.note ?? "—"}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {e.occurredOn}
                    {e.freescoutNumber ? ` · #${e.freescoutNumber}` : ""}
                    {e.author ? <span className="capitalize"> · {e.author}</span> : ""}
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
