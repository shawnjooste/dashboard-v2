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

export function QuoteStatusPill({ status }: { status: DerivedStatus }) {
  return (
    <span className={`rounded-full px-[11px] py-1 text-[12.5px] font-semibold ${STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
