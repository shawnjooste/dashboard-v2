import type { DerivedStatus } from "@/lib/quotes/doc";
import { STATUS_LABEL } from "@/lib/quotes/doc";

const STYLE: Record<DerivedStatus, string> = {
  draft: "bg-line-soft text-ink-3",
  sent: "bg-warn-tint text-warn",
  accepted: "bg-good-tint text-good",
  rejected: "bg-brand-tint text-brand",
  changes_requested: "bg-warn-tint-2 text-warn-ink",
  expired: "bg-line-soft text-muted",
};

export function QuoteStatusPill({ status, admin }: { status: DerivedStatus; admin?: boolean }) {
  // From an admin's seat, a 'sent' quote is awaiting the *client's* decision.
  const label = admin && status === "sent" ? "Awaiting client decision" : STATUS_LABEL[status];
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-[11px] py-1 text-[12.5px] font-semibold ${STYLE[status]}`}>
      {label}
    </span>
  );
}
