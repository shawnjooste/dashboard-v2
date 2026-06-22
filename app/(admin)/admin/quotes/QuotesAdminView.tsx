"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { fmtMoney, formatQuoteAmount } from "@/lib/quotes/doc";
import type { AdminQuoteRow } from "@/lib/views/quotes";
import { QuoteStatusPill } from "@/components/QuoteStatusPill";
import { setQuoteInvoiced } from "./actions";

type Bucket = "all" | "awaiting" | "changes" | "toinvoice" | "invoiced" | "closed";

function bucketOf(q: AdminQuoteRow): Exclude<Bucket, "all"> | "draft" {
  if (q.status === "sent") return "awaiting";
  if (q.status === "changes_requested") return "changes";
  if (q.status === "accepted") return q.invoicedAt ? "invoiced" : "toinvoice";
  if (q.status === "rejected" || q.status === "expired") return "closed";
  return "draft";
}

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "18 Jun 2026" from an ISO timestamp — deterministic (no locale/TZ) for SSR. */
function sentDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function QuotesAdminView({ quotes }: { quotes: AdminQuoteRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Bucket>("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const counts = useMemo(() => {
    const c = { all: quotes.length, awaiting: 0, changes: 0, toinvoice: 0, invoiced: 0, closed: 0 };
    for (const x of quotes) {
      const b = bucketOf(x);
      if (b !== "draft") c[b] += 1;
    }
    return c;
  }, [quotes]);

  const toInvoiceValue = useMemo(
    () => quotes.filter((x) => bucketOf(x) === "toinvoice").reduce((n, x) => n + (x.grandTotal ?? 0), 0),
    [quotes],
  );

  const rows = useMemo(() => {
    let r = quotes.slice();
    if (filter !== "all") r = r.filter((x) => bucketOf(x) === filter);
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((x) => `${x.quoteNumber} ${x.clientName} ${x.title}`.toLowerCase().includes(needle));
    r.sort((a, b) => {
      const cmp = a.quoteNumber.localeCompare(b.quoteNumber);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [quotes, filter, q, sortDir]);

  const tiles: { key: Bucket; label: string; value: number; dot: string; hot: boolean }[] = [
    { key: "all", label: "ALL", value: counts.all, dot: "#18181B", hot: false },
    { key: "awaiting", label: "AWAITING CLIENT", value: counts.awaiting, dot: "#185FA5", hot: false },
    { key: "changes", label: "CHANGES ASKED", value: counts.changes, dot: "#B45309", hot: counts.changes > 0 },
    { key: "toinvoice", label: "TO INVOICE", value: counts.toinvoice, dot: "#D7141C", hot: counts.toinvoice > 0 },
    { key: "invoiced", label: "INVOICED", value: counts.invoiced, dot: "#15803D", hot: false },
    { key: "closed", label: "CLOSED", value: counts.closed, dot: "#94A3B8", hot: false },
  ];

  const cols = "grid-cols-[120px_minmax(0,1fr)_minmax(0,1.3fr)_104px_110px_172px_132px]";

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-[30px] font-bold tracking-[-0.6px] text-ink">Quotes</h1>
        <span className="rounded-full border border-line bg-line-soft px-[11px] py-[3px] text-[13px] font-semibold text-ink-3">
          {quotes.length}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-muted">
        Every quote across all clients.{" "}
        {toInvoiceValue > 0 && (
          <span className="font-semibold text-[#B01218]">{fmtMoney(toInvoiceValue)} accepted and waiting to be invoiced.</span>
        )}
      </p>

      {/* Search */}
      <div className="mt-6 flex items-center gap-[11px] rounded-xl border border-line bg-card px-[18px] py-3.5 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
        <span className="text-[17px] text-faint">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by quote number, client or title..."
          className="flex-1 border-none bg-transparent text-[15px] text-ink outline-none"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="rounded-md border border-line px-[9px] py-1 text-xs font-semibold text-muted hover:bg-line-soft"
          >
            Clear
          </button>
        )}
      </div>

      {/* Status tiles */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => {
          const active = filter === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`rounded-[10px] border bg-card px-4 py-3.5 text-left transition-colors ${active ? "border-brand" : "border-line hover:border-faint"}`}
            >
              <span className="flex items-center gap-[7px]">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: t.dot }} />
                <span className="text-[11px] font-semibold tracking-[0.3px] text-muted">{t.label}</span>
              </span>
              <span className="mt-2 block text-[24px] font-bold leading-none" style={{ color: t.hot ? t.dot : "#18181B" }}>
                {t.value}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
        <div className={`grid ${cols} items-center gap-3.5 border-b border-line-soft bg-[#FCFCFD] px-5 py-[11px]`}>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="flex items-center gap-1.5 text-left text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint"
          >
            <span>Quote</span>
            <span className="text-brand">{sortDir === "asc" ? "↑" : "↓"}</span>
          </button>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">Client</div>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">Title</div>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">Sent</div>
          <div className="text-right text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">Amount</div>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">Status</div>
          <div />
        </div>

        {rows.map((x) => (
          <div
            key={x.id}
            className={`grid ${cols} items-center gap-3.5 border-b border-line-soft px-5 py-3 last:border-0 hover:bg-[#FAFAFA]`}
          >
            <Link href={`/admin/quotes/${x.id}`} className="truncate text-[13px] font-semibold text-ink hover:text-brand">
              {x.quoteNumber}
            </Link>
            <div className="truncate text-[13px] text-ink-2">{x.clientName}</div>
            <div className="truncate text-[13px] text-ink-3">{x.title}</div>
            <div className="whitespace-nowrap text-[13px] text-ink-3">{sentDate(x.createdAt)}</div>
            <div className="whitespace-nowrap text-right text-[13px] font-semibold text-ink">
              {formatQuoteAmount(x.grandTotal, x.monthlyTotal)}
            </div>
            <div>
              <QuoteStatusPill status={x.status} admin />
            </div>
            <div className="flex justify-end">
              <InvoiceAction quote={x} />
            </div>
          </div>
        ))}

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-[15px] font-semibold text-ink-3">No quotes here</div>
            <div className="mt-[5px] text-[13.5px] text-faint">Try a different search or filter.</div>
          </div>
        ) : (
          <div className="px-5 py-3 text-[12.5px] text-faint">
            Showing {rows.length} of {quotes.length} quotes
          </div>
        )}
      </div>
    </div>
  );
}

/** Mark-invoiced / undo, shown only on accepted quotes. */
function InvoiceAction({ quote }: { quote: AdminQuoteRow }) {
  const [pending, startTransition] = useTransition();
  if (quote.status !== "accepted") return null;

  const submit = (invoiced: boolean) => {
    const fd = new FormData();
    fd.set("quote_id", quote.id);
    fd.set("invoiced", String(invoiced));
    startTransition(async () => {
      await setQuoteInvoiced(fd);
    });
  };

  if (quote.invoicedAt) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded-full bg-good-tint px-[9px] py-1 text-[11.5px] font-semibold text-good">
          Invoiced {shortDate(quote.invoicedAt)}
        </span>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={pending}
          title="Undo"
          className="rounded-md border border-line px-1.5 py-1 text-[11px] font-semibold text-muted hover:bg-line-soft disabled:opacity-60"
        >
          ↩
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => submit(true)}
      disabled={pending}
      className="rounded-md bg-ink px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
    >
      {pending ? "…" : "Mark invoiced"}
    </button>
  );
}
