import { createClient } from "@/lib/supabase/server";
import { setSuspension } from "../actions";
import { Card, CardHeader } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

/** Staff-only: suspend or restore this client's services. Setting it shows a
 *  standing banner to every user at the client; lifting it removes it on their
 *  next page load. A notice only — nothing in the portal is gated either way,
 *  so they can still see the bill, pay it, and reach support. */
export async function SuspensionSection({ clientId }: { clientId: string }) {
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("suspended_at, suspension_note")
    .eq("id", clientId)
    .maybeSingle();
  const suspended = !!client?.suspended_at;
  const save = setSuspension.bind(null, clientId);

  return (
    <Card>
      <CardHeader title="Service suspension" count={suspended ? "Suspended" : "Active"} />
      <form action={save} className="flex flex-wrap items-center gap-2 px-4 py-3.5">
        <label className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-ink-2">
          <input type="checkbox" name="suspend" defaultChecked={suspended} />
          Suspended
        </label>
        <input
          name="note"
          defaultValue={client?.suspension_note ?? ""}
          placeholder="What's paused and what they should do — every user at this client reads this"
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
          Save
        </button>
      </form>
      {suspended && (
        <p className="px-4 pb-3.5 text-xs text-muted">
          Suspended {client?.suspended_at?.slice(0, 10)} — the banner is live for this client now.
          Untick and save to lift it.
        </p>
      )}
    </Card>
  );
}
