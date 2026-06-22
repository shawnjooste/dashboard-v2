import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getVisibleQuotes } from "@/lib/views/quotes";
import { formatQuoteAmount } from "@/lib/quotes/doc";
import { QuoteStatusPill } from "@/components/QuoteStatusPill";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function AdminClientQuotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: client }, quotes] = await Promise.all([
    supabase.from("clients").select("name").eq("id", id).maybeSingle(),
    getVisibleQuotes(id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href={`/admin/clients/${id}`} className="hover:text-ink">
            ← {client?.name ?? "Client"}
          </Link>
        }
        title="Quotes"
        subtitle="Create quotes via the co-work flow: paste a supplier quote at Claude, approve the draft, and it lands here."
      />
      {quotes.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">No quotes for this client yet.</p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Quotes" count={quotes.length} />
          {quotes.map((q) => (
            <Link
              key={q.id}
              href={`/admin/quotes/${q.id}`}
              className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 last:border-0 hover:bg-canvas"
            >
              <span className="w-20 shrink-0 text-[12.5px] text-faint">{q.quoteNumber}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-ink">{q.title}</span>
                <span className="mt-px block text-xs text-faint">
                  {formatQuoteAmount(q.grandTotal, q.monthlyTotal, { per: "month" })} incl VAT
                  {q.validUntil ? ` · valid until ${q.validUntil}` : ""}
                </span>
              </span>
              <QuoteStatusPill status={q.status} admin />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
