import Link from "next/link";
import { getJobBoard, getJobFormOptions } from "@/lib/views/jobs";
import { toDateString, filterJobCards } from "@/lib/job-board-helpers";
import { getCurrentProfile } from "@/lib/auth/profile";
import { PageHeader } from "@/components/ui";
import { NewJobDialog } from "./NewJobDialog";
import { JobBoard } from "./JobBoard";

const PILL = "rounded-full px-3 py-1 text-[12.5px] font-semibold";
const SELECT = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none";

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; owner?: string; assignee?: string; mine?: string }>;
}) {
  const params = await searchParams;
  const [cards, { clients, staff }, me] = await Promise.all([
    getJobBoard(),
    getJobFormOptions(),
    getCurrentProfile(),
  ]);
  // Computed server-side so the due badge renders identically on both sides.
  const today = toDateString(new Date());

  const myId = me.authenticated ? me.profile.id : "";
  const mine = params.mine === "1" && !!myId;
  const filters = {
    client: params.client ?? "",
    owner: params.owner ?? "",
    assignee: params.assignee ?? "",
    mineProfileId: mine ? myId : undefined,
  };
  const visible = filterJobCards(cards, filters);

  // Options come from the cards on the board, so you can never pick an empty filter.
  const clientOptions = [...new Map(cards.map((c) => [c.clientId, c.clientName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const ownerOptions = [
    ...new Map(cards.filter((c) => c.ownerProfileId).map((c) => [c.ownerProfileId!, c.ownerLabel ?? ""])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const assigneeOptions = [
    ...new Map(cards.flatMap((c) => c.assignees).map((a) => [a.id, a.label])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      client: filters.client,
      owner: filters.owner,
      assignee: filters.assignee,
      mine: mine ? "1" : "",
      ...over,
    });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    const q = p.toString();
    return q ? `/admin/jobs?${q}` : "/admin/jobs";
  };
  const filtered = visible.length !== cards.length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Jobs" subtitle="Work in progress across all clients." />
        <NewJobDialog clients={clients} staff={staff} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ mine: "" })} className={`${PILL} ${!mine ? "bg-ink text-white" : "bg-line-soft text-ink-3 hover:bg-line"}`}>
          All jobs
        </Link>
        <Link href={qs({ mine: "1" })} className={`${PILL} ${mine ? "bg-ink text-white" : "bg-line-soft text-ink-3 hover:bg-line"}`}>
          Just mine
        </Link>
        <Link href="/admin/jobs/mine" className={`${PILL} bg-line-soft text-ink-3 hover:bg-line`}>
          My work →
        </Link>

        <form className="ml-auto flex flex-wrap items-center gap-2" action="/admin/jobs" method="get">
          {mine && <input type="hidden" name="mine" value="1" />}
          <select name="client" defaultValue={filters.client} className={SELECT}>
            <option value="">All clients</option>
            {clientOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select name="owner" defaultValue={filters.owner} className={SELECT}>
            <option value="">Any owner</option>
            {ownerOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select name="assignee" defaultValue={filters.assignee} className={SELECT}>
            <option value="">Any assignee</option>
            {assigneeOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <button className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
            Apply
          </button>
        </form>
      </div>

      {filtered && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>
            Showing {visible.length} of {cards.length} jobs
          </span>
          <Link href="/admin/jobs" className="text-brand hover:text-brand-dark">
            Clear filters
          </Link>
        </div>
      )}

      <JobBoard cards={visible} today={today} />
    </div>
  );
}
