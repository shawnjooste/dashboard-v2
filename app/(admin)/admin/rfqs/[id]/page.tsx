import Link from "next/link";
import { getRfqDetail, type RfqEvent } from "@/lib/views/rfqs";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { saveRfqDetails } from "../actions";
import { RfqStatusControl } from "./RfqStatusControl";
import { LinkQuote } from "./LinkQuote";

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.3px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";
const fmtTs = (ts: string) => ts.replace("T", " ").slice(0, 16);
const KIND_LABEL: Record<string, string> = { created: "Created", status: "Stage change", quote_linked: "Quote linked", note: "Note" };

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rfq = await getRfqDetail(id);
  if (!rfq) {
    return (
      <p className="text-muted">
        RFQ not found. <Link href="/admin/rfqs" className="text-brand hover:text-brand-dark">← RFQs</Link>
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <Link href="/admin/rfqs" className="hover:text-ink">
            ← RFQs
          </Link>
        }
        title={rfq.title}
        subtitle={
          <span>
            {rfq.clientLabel}
            {rfq.requestedBy && <span className="text-faint"> · from {rfq.requestedBy}</span>}
          </span>
        }
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          <RfqStatusControl rfqId={rfq.id} status={rfq.status} sourcingNote={rfq.sourcingNote} lostReason={rfq.lostReason} />

          <Card>
            <CardHeader title="Request" />
            <form action={saveRfqDetails} className="space-y-3 px-4 py-4">
              <input type="hidden" name="rfq_id" value={rfq.id} />
              <label className="block">
                <span className={LABEL}>Requested by</span>
                <input name="requested_by" defaultValue={rfq.requestedBy ?? ""} className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>What they want</span>
                <textarea name="description" rows={4} defaultValue={rfq.description ?? ""} className={FIELD} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>Needed by</span>
                  <input name="needed_by" type="date" defaultValue={rfq.neededBy ?? ""} className={FIELD} />
                </label>
              </div>
              <label className="block">
                <span className={LABEL}>Internal notes</span>
                <textarea name="notes" rows={2} defaultValue={rfq.notes ?? ""} placeholder="Never shown to the client." className={FIELD} />
              </label>
              <div className="flex justify-end">
                <button className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
                  Save
                </button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-4 lg:w-[340px] lg:shrink-0">
          <Card>
            <CardHeader title="Quote" />
            <LinkQuote
              rfqId={rfq.id}
              clientId={rfq.clientId}
              quoteId={rfq.quoteId}
              quoteNumber={rfq.quoteNumber}
              linkableQuotes={rfq.linkableQuotes}
            />
          </Card>

          <Card>
            <CardHeader title="Activity" count={rfq.events.length} />
            {rfq.events.length === 0 ? (
              <div className="px-4 py-4 text-xs text-faint">No activity yet.</div>
            ) : (
              rfq.events.map((e) => <EventRow key={e.id} e={e} />)
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function EventRow({ e }: { e: RfqEvent }) {
  return (
    <div className="border-b border-line-soft px-4 py-2.5 text-sm last:border-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink">{KIND_LABEL[e.kind] ?? e.kind}</span>
        {e.body && <span className="text-[13px] text-ink-2">{e.body}</span>}
        <span className="ml-auto text-xs text-faint">{fmtTs(e.createdAt)}</span>
      </div>
      {e.author && <div className="mt-0.5 text-xs capitalize text-faint">{e.author}</div>}
    </div>
  );
}
