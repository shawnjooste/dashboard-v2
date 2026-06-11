/** Quote document — the same shape as the print template's quote-data.js.
 *  Pure logic only: no imports, unit-tested. Supplier costs are NEVER part of
 *  this document; they live in the staff-only quote_internal table. */

export type QuoteItem = {
  description: string;
  detail?: string;
  /** null qty/unitPrice = usage-based line (shows usageNote / totalNote). */
  qty: number | null;
  unitPrice: number | null;
  usageNote?: string;
  totalNote?: string;
};

export type QuoteGroup = { name: string; items: QuoteItem[] };

export type QuoteSection = {
  id: string;
  title: string;
  subtitle?: string;
  totalLabel: string;
  /** Monthly-recurring section: totals labelled "/ month". Defaults from id === "recurring". */
  monthly?: boolean;
  groups: QuoteGroup[];
};

export type QuoteDoc = {
  company: {
    name: string;
    addressLines: string[];
    vat: string;
    regNumber: string;
    registeredOffice: string;
  };
  client: { name: string; addressLines: string[]; attention: string };
  meta: { quoteNumber: string; date: string; validUntil: string; preparedBy: string };
  projectTitle: string;
  projectIntro: string;
  sections: QuoteSection[];
  summaryNote?: string;
  terms: string[];
  banking: { bank: string; account: string; branch: string; branchCode: string; reference: string };
  vatPercent: number;
};

export const fmtMoney = (n: number | null | undefined): string => {
  if (n == null || isNaN(n)) return "—";
  return (
    "R " + Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
};

export const isMonthly = (s: QuoteSection): boolean => s.monthly ?? s.id === "recurring";

export type SectionTotals = {
  id: string;
  title: string;
  totalLabel: string;
  monthly: boolean;
  subtotal: number;
  vat: number;
  grand: number;
};

export type QuoteTotals = {
  sections: SectionTotals[];
  /** Once-off figures — what lands in quotes_versions.subtotal/vat_amount/grand_total. */
  subtotal: number;
  vat: number;
  grand: number;
  /** Recurring grand (incl VAT) per month, null when no monthly section. */
  monthly: number | null;
};

/** Per-section and rolled-up totals. Usage-based lines (null qty/price) are skipped. */
export function computeTotals(doc: Pick<QuoteDoc, "sections" | "vatPercent">): QuoteTotals {
  const rate = doc.vatPercent / 100;
  const sections: SectionTotals[] = doc.sections.map((s) => {
    let subtotal = 0;
    for (const g of s.groups)
      for (const it of g.items)
        if (it.qty != null && it.unitPrice != null) subtotal += it.qty * it.unitPrice;
    const vat = subtotal * rate;
    return {
      id: s.id,
      title: s.title,
      totalLabel: s.totalLabel,
      monthly: isMonthly(s),
      subtotal,
      vat,
      grand: subtotal + vat,
    };
  });
  const onceOff = sections.filter((s) => !s.monthly);
  const monthlySecs = sections.filter((s) => s.monthly);
  const subtotal = onceOff.reduce((n, s) => n + s.subtotal, 0);
  const vat = onceOff.reduce((n, s) => n + s.vat, 0);
  return {
    sections,
    subtotal,
    vat,
    grand: subtotal + vat,
    monthly: monthlySecs.length ? monthlySecs.reduce((n, s) => n + s.grand, 0) : null,
  };
}

/** Stable address of a line item inside the doc — keys quote_internal rows. */
export const linePath = (sIdx: number, gIdx: number, iIdx: number): string =>
  `s${sIdx}.g${gIdx}.i${iIdx}`;

/** A sent quote past its valid-until date is expired (derived, never stored). */
export function isExpired(validUntil: string | null, today = new Date()): boolean {
  if (!validUntil) return false;
  return validUntil < today.toISOString().slice(0, 10);
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "changes_requested";
export type DerivedStatus = QuoteStatus | "expired";

export function derivedStatus(
  status: QuoteStatus,
  validUntil: string | null,
  today = new Date(),
): DerivedStatus {
  return status === "sent" && isExpired(validUntil, today) ? "expired" : status;
}

export const STATUS_LABEL: Record<DerivedStatus, string> = {
  draft: "Draft",
  sent: "Awaiting your decision",
  accepted: "Accepted",
  rejected: "Declined",
  changes_requested: "Changes requested",
  expired: "Expired",
};
