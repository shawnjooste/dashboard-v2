import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyWork } from "@/lib/views/jobs";
import { getCurrentProfile } from "@/lib/auth/profile";
import { compareByDue, dueState, toDateString } from "@/lib/job-board-helpers";
import { PageHeader, Card, CardHeader } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
  cancelled: "Cancelled",
};

function DueTag({ dueDate, today }: { dueDate: string | null; today: string }) {
  const state = dueState(dueDate, today);
  if (state === "overdue") {
    return <span className="rounded bg-[#FEE2E2] px-1.5 py-0.5 text-[11px] font-semibold text-[#B91C1C]">Overdue</span>;
  }
  if (state === "due_soon") {
    return <span className="rounded bg-warn-tint px-1.5 py-0.5 text-[11px] text-warn-ink">Due soon</span>;
  }
  return null;
}

export default async function MyWorkPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const work = await getMyWork(me.profile.id);
  const today = toDateString(new Date());
  const ownedJobs = [...work.ownedJobs].sort(compareByDue);
  const assignedTasks = [...work.assignedTasks].sort(compareByDue);

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <Link href="/admin/jobs" className="hover:text-ink">
            ← Jobs
          </Link>
        }
        title="My work"
        subtitle="Everything open that you own or have been assigned."
      />

      <Card>
        <CardHeader title="Jobs you own" count={ownedJobs.length} />
        {ownedJobs.length === 0 ? (
          <div className="px-4 py-4 text-xs text-faint">Nothing open.</div>
        ) : (
          ownedJobs.map((j) => (
            <Link
              key={j.id}
              href={`/admin/jobs/${j.id}`}
              className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0 hover:bg-line-soft"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-ink">{j.title}</div>
                <div className="truncate text-xs text-muted">{j.clientName}</div>
              </div>
              {j.taskTotal > 0 && (
                <span className="shrink-0 text-[11px] text-faint">
                  {j.taskDone}/{j.taskTotal} done
                </span>
              )}
              <DueTag dueDate={j.dueDate} today={today} />
              <span className="shrink-0 text-[11px] text-ink-3">{STATUS_LABEL[j.status] ?? j.status}</span>
            </Link>
          ))
        )}
      </Card>

      <Card>
        <CardHeader title="Tasks assigned to you" count={assignedTasks.length} />
        {assignedTasks.length === 0 ? (
          <div className="px-4 py-4 text-xs text-faint">Nothing assigned.</div>
        ) : (
          assignedTasks.map((t) => (
            <Link
              key={t.id}
              href={`/admin/jobs/${t.jobId}`}
              className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0 hover:bg-line-soft"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-ink">{t.label}</div>
                <div className="truncate text-xs text-muted">
                  {t.jobTitle} · {t.clientName}
                </div>
              </div>
              <DueTag dueDate={t.dueDate} today={today} />
            </Link>
          ))
        )}
      </Card>
    </div>
  );
}
