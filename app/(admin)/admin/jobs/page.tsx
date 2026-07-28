import { getJobBoard, getJobFormOptions } from "@/lib/views/jobs";
import { toDateString } from "@/lib/job-board-helpers";
import { PageHeader } from "@/components/ui";
import { NewJobDialog } from "./NewJobDialog";
import { JobBoard } from "./JobBoard";

export default async function AdminJobsPage() {
  const [cards, { clients, staff }] = await Promise.all([getJobBoard(), getJobFormOptions()]);
  // Computed server-side so the due badge renders identically on both sides.
  const today = toDateString(new Date());

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Jobs" subtitle="Work in progress across all clients." />
        <NewJobDialog clients={clients} staff={staff} />
      </div>

      <JobBoard cards={cards} today={today} />
    </div>
  );
}
