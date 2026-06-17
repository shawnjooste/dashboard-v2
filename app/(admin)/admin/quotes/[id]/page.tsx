import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getQuoteAdminDetail } from "@/lib/views/quotes";
import { computeTotals, fmtMoney } from "@/lib/quotes/doc";
import { QuoteDocument } from "@/components/QuoteDocument";
import { QuoteStatusPill } from "@/components/QuoteStatusPill";
import { Card, CardHeader, PageHeader } from "@/components/ui";

const fmtTs = (ts: string) => ts.replace("T", " ").slice(0, 16);

export default async function AdminQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quote = await getQuoteAdminDetail(id);
  if (!quote) {
    return (
      <div className="space-y-4">
        <p className="text-muted">
          Quote not found.{" "}
          <Link href="/admin" className="text-brand hover:text-brand-dark">← Admin</Link>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", quote.clientId)
    .maybeSingle();

  const totals = computeTotals(quote.doc);
  const marginPct =
    quote.margin !== null && quote.supplierCost !== null && quote.supplierCost > 0
      ? Math.round((100 * quote.margin) / quote.supplierCost)
      : null;

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <PageHeader
          breadcrumb={
            <Link href={`/admin/clients/${quote.clientId}/quotes`} className="hover:text-ink">
              ← Quotes · {client?.name ?? "Client"}
            </Link>
          }
          title={`${quote.quoteNumber} — ${quote.title}`}
          subtitle={
            <span className="inline-flex items-center gap-2">
              <span>v{quote.version}</span>
              <QuoteStatusPill status={quote.status} admin />
            </span>
          }
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3 print:hidden">
        {/* Margin (internal) */}
        <Card>
          <CardHeader title="Margin (internal)" />
          <dl className="space-y-1.5 px-4 py-3.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Price (ex VAT)</dt>
              <dd className="font-medium text-ink-2">{fmtMoney(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Supplier cost</dt>
              <dd className="font-medium text-ink-2">
                {quote.supplierCost === null ? "—" : fmtMoney(quote.supplierCost)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Margin</dt>
              <dd className={`font-semibold ${quote.margin !== null && quote.margin < 0 ? "text-brand" : "text-good"}`}>
                {quote.margin === null ? "—" : fmtMoney(quote.margin)}
                {marginPct !== null ? ` (${marginPct}%)` : ""}
              </dd>
            </div>
            {totals.monthly !== null && (
              <div className="flex justify-between">
                <dt className="text-muted">Recurring (incl VAT)</dt>
                <dd className="font-medium text-ink-2">{fmtMoney(totals.monthly)} / month</dd>
              </div>
            )}
          </dl>
        </Card>

        {/* Versions */}
        <Card>
          <CardHeader title="Versions" count={quote.versions.length} />
          {quote.versions.map((v) => (
            <div
              key={v.version}
              className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 text-sm last:border-0"
            >
              <span className={`font-semibold ${v.version === quote.version ? "text-ink" : "text-faint"}`}>
                v{v.version}
                {v.version === quote.version ? " · current" : ""}
              </span>
              <span className="ml-auto text-ink-2">{fmtMoney(v.grandTotal)}</span>
              <span className="text-xs text-faint">{fmtTs(v.createdAt)}</span>
            </div>
          ))}
        </Card>

        {/* Events */}
        <Card>
          <CardHeader title="Activity" count={quote.events.length} />
          {quote.events.map((e, i) => (
            <div key={i} className="border-b border-line-soft px-4 py-2.5 text-sm last:border-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{e.event.replace("_", " ")}</span>
                {e.version != null && <span className="text-xs text-faint">v{e.version}</span>}
                <span className="ml-auto text-xs text-faint">{fmtTs(e.at)}</span>
              </div>
              {(e.actorName || e.comment) && (
                <div className="mt-0.5 text-xs text-muted">
                  {e.actorName}
                  {e.comment ? ` — “${e.comment}”` : ""}
                </div>
              )}
            </div>
          ))}
        </Card>
      </div>

      <QuoteDocument doc={quote.doc} />
    </div>
  );
}
