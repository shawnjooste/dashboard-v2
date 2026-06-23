import Link from "next/link";
import { getJobDetail, getJobAssignees, getJobFormOptions, type JobUpdate } from "@/lib/views/jobs";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { saveJobNotes } from "../actions";
import { JobStatusControl } from "./JobStatusControl";
import { JobOwnerControl } from "./JobOwnerControl";
import { JobChecklist } from "./JobChecklist";
import { PostUpdate } from "./PostUpdate";

const fmtTs = (ts: string) => ts.replace("T", " ").slice(0, 16);
const KIND_LABEL: Record<string, string> = { opened: "Opened", completed: "Completed", update: "Update sent" };

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJobDetail(id);
  if (!job) {
    return (
      <p className="text-muted">
        Job not found. <Link href="/admin/jobs" className="text-brand hover:text-brand-dark">← Jobs</Link>
      </p>
    );
  }
  const [assignees, { staff }] = await Promise.all([getJobAssignees(job.clientId), getJobFormOptions()]);

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <Link href="/admin/jobs" className="hover:text-ink">
            ← Jobs
          </Link>
        }
        title={job.title}
        subtitle={
          <span>
            {job.clientName}
            {job.quoteNumber && (
              <>
                {" · from "}
                <Link href={`/admin/quotes/${job.quoteId}`} className="text-brand hover:text-brand-dark">
                  {job.quoteNumber}
                </Link>
              </>
            )}
          </span>
        }
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          <JobStatusControl jobId={job.id} status={job.status} waitingNote={job.waitingNote} />

          <JobOwnerControl jobId={job.id} ownerProfileId={job.ownerProfileId} staff={staff} />

          <Card>
            <CardHeader title="Checklist" count={job.tasks.length} />
            <JobChecklist jobId={job.id} tasks={job.tasks} assignees={assignees} />
          </Card>

          <Card>
            <CardHeader title="Internal notes" />
            <form action={saveJobNotes} className="space-y-2 px-4 py-3.5">
              <input type="hidden" name="job_id" value={job.id} />
              <textarea
                name="notes"
                rows={3}
                defaultValue={job.notes ?? ""}
                placeholder="Internal notes — never shown to the client."
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint"
              />
              <div className="flex justify-end">
                <button className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
                  Save notes
                </button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-4 lg:w-[340px] lg:shrink-0">
          <Card>
            <CardHeader title="Client updates" count={job.updates.length} />
            <div className="border-b border-line-soft px-4 py-3.5">
              <PostUpdate jobId={job.id} />
            </div>
            {job.updates.length === 0 ? (
              <div className="px-4 py-4 text-xs text-faint">No activity yet.</div>
            ) : (
              job.updates.map((u) => <UpdateRow key={u.id} u={u} />)
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function UpdateRow({ u }: { u: JobUpdate }) {
  return (
    <div className="border-b border-line-soft px-4 py-2.5 text-sm last:border-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink">{KIND_LABEL[u.kind] ?? u.kind}</span>
        <span className="ml-auto text-xs text-faint">{fmtTs(u.createdAt)}</span>
      </div>
      {u.body && <div className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink-2">{u.body}</div>}
      <div className="mt-0.5 text-xs text-faint">
        {u.author ? <span className="capitalize">{u.author}</span> : "—"}
        {u.emailedCount > 0 ? ` · emailed ${u.emailedCount}` : ""}
      </div>
    </div>
  );
}
