import type { ClientBilling, BillingInvoice } from "@/lib/views/billing";
import { Card, CardHeader } from "@/components/ui";

function money(n: number | null, ccy: string | null): string {
  if (n == null) return "—";
  return `${ccy ?? ""} ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

function Rows({ invoices, today }: { invoices: BillingInvoice[]; today: string }) {
  if (invoices.length === 0) return <p className="px-4 py-3.5 text-sm text-muted">Nothing here.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
        <tr><th className="px-4 py-2.5">Invoice</th><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5 text-right">Amount</th></tr>
      </thead>
      <tbody>
        {invoices.map((i) => {
          const overdue = (i.amountDue ?? 0) > 0 && i.dueDate != null && i.dueDate < today;
          return (
            <tr key={i.id} className="border-b border-line-soft last:border-0">
              <td className="px-4 py-2.5 font-medium text-ink">{i.number ?? "—"}</td>
              <td className="px-4 py-2.5 text-muted">{i.date ?? "—"}</td>
              <td className={`px-4 py-2.5 ${overdue ? "font-semibold text-brand" : "text-muted"}`}>{i.dueDate ?? "—"}{overdue ? " · overdue" : ""}</td>
              <td className="px-4 py-2.5 text-right font-medium text-ink">{money((i.amountDue ?? 0) > 0 ? i.amountDue : i.total, i.currency)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function BillingView({ billing, today }: { billing: ClientBilling; today: string }) {
  return (
    <div className="space-y-5">
      <Card className="p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">Outstanding balance</p>
        <p className="mt-1 text-[30px] font-bold text-ink">{money(billing.outstanding, billing.currency)}</p>
        <p className="mt-1 text-sm text-muted">
          {billing.overdue > 0 ? <span className="font-semibold text-brand">{money(billing.overdue, billing.currency)} overdue · </span> : null}
          {billing.asOf ? `as of ${billing.asOf}` : ""}
        </p>
      </Card>

      <Card>
        <CardHeader title="Open invoices" count={billing.open.length} />
        <Rows invoices={billing.open} today={today} />
      </Card>

      {billing.creditNotes.length > 0 && (
        <Card>
          <CardHeader title="Credit notes" count={billing.creditNotes.length} />
          <Rows invoices={billing.creditNotes} today={today} />
        </Card>
      )}

      <Card>
        <CardHeader title="Paid" count={billing.paid.length} />
        <Rows invoices={billing.paid} today={today} />
      </Card>
    </div>
  );
}
