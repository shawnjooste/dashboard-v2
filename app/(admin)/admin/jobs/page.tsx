import Link from "next/link";
import {
  getJobBoard,
  getJobFormOptions,
  BOARD_STATUSES,
  JOB_STATUS_LABEL,
  type JobStatus,
  type JobCard,
} from "@/lib/views/jobs";
import { PageHeader, initials } from "@/components/ui";
import { NewJobDialog } from "./NewJobDialog";

const DOT: Record<JobStatus, string> = {
  todo: "#94A3B8",
  in_progress: "#185FA5",
  waiting: "#B45309",
  done: "#15803D",
  cancelled: "#94A3B8",
};

export default async function AdminJobsPage() {
  const [cards, { clients, staff }] = await Promise.all([getJobBoard(), getJobFormOptions()]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Jobs" subtitle="Work in progress across all clients." />
        <NewJobDialog clients={clients} staff={staff} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_STATUSES.map((s) => {
          const col = cards.filter((c) => c.status === s);
          return (
            <div key={s} className="rounded-xl border border-line bg-[#FCFCFD] p-2.5">
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: DOT[s] }} />
                <span className="text-[12.5px] font-semibold text-ink">{JOB_STATUS_LABEL[s]}</span>
                <span className="ml-auto text-[11px] text-faint">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map((c) => (
                  <JobCardView key={c.id} card={c} />
                ))}
                {col.length === 0 && <div className="px-1 py-6 text-center text-xs text-faint">Nothing here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JobCardView({ card }: { card: JobCard }) {
  return (
    <Link href={`/admin/jobs/${card.id}`} className="block rounded-lg border border-line bg-card p-3 transition-colors hover:border-faint">
      <div className="text-[13px] font-semibold leading-snug text-ink">{card.title}</div>
      <div className="mt-0.5 truncate text-xs text-muted">{card.clientName}</div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {card.ownerLabel && (
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] font-semibold uppercase text-white"
            title={card.ownerLabel}
          >
            {initials(card.ownerLabel)}
          </span>
        )}
        {card.taskTotal > 0 && (
          <span className="text-[11px] text-faint">
            {card.taskDone}/{card.taskTotal} done
          </span>
        )}
        {card.fromQuote && (
          <span className="rounded bg-line-soft px-1.5 py-0.5 text-[11px] text-ink-3">from quote</span>
        )}
        {card.status === "waiting" && card.waitingNote && (
          <span className="rounded bg-warn-tint px-1.5 py-0.5 text-[11px] text-warn-ink">{card.waitingNote}</span>
        )}
      </div>
    </Link>
  );
}
