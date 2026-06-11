import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getVisibleQuotes } from "@/lib/views/quotes";
import { fmtMoney } from "@/lib/quotes/doc";
import { QuoteStatusPill } from "@/components/QuoteStatusPill";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function QuotesPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "client_manager") redirect("/");

  const quotes = await getVisibleQuotes();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotes"
        subtitle="Quotes from Rocking — review, print, and accept or decline online."
      />
      {quotes.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">No quotes yet.</p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Your quotes" count={quotes.length} />
          {quotes.map((q) => (
            <Link
              key={q.id}
              href={`/quotes/${q.id}`}
              className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 last:border-0 hover:bg-canvas"
            >
              <span className="w-20 shrink-0 text-[12.5px] text-faint">{q.quoteNumber}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-ink">{q.title}</span>
                <span className="mt-px block text-xs text-faint">
                  {fmtMoney(q.grandTotal)} incl VAT
                  {q.monthlyTotal != null ? ` + ${fmtMoney(q.monthlyTotal)} / month` : ""}
                  {q.validUntil ? ` · valid until ${q.validUntil}` : ""}
                </span>
              </span>
              <QuoteStatusPill status={q.status} />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
