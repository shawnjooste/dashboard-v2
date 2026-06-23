import Link from "next/link";
import {
  getRfqBoard,
  getRfqFormClients,
  BOARD_STATUSES,
  RFQ_STATUS_LABEL,
  type RfqStatus,
  type RfqCard,
  type CardTag,
} from "@/lib/views/rfqs";
import { PageHeader } from "@/components/ui";
import { NewRfqDialog } from "./NewRfqDialog";

const DOT: Record<RfqStatus, string> = {
  new: "#94A3B8",
  sourcing: "#B45309",
  quoted: "#185FA5",
  won: "#15803D",
  lost: "#94A3B8",
};

const TAG_CLASS: Record<CardTag["tone"], string> = {
  warn: "bg-warn-tint text-warn-ink",
  info: "bg-line-soft text-ink-3",
  good: "bg-[#E9F7EF] text-good",
};

export default async function AdminRfqsPage() {
  const [cards, clients] = await Promise.all([getRfqBoard(), getRfqFormClients()]);
  const lost = cards.filter((c) => c.status === "lost");

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="RFQs" subtitle="Incoming quote requests across all clients." />
        <NewRfqDialog clients={clients} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_STATUSES.map((s) => {
          const col = cards.filter((c) => c.status === s);
          return (
            <div key={s} className="rounded-xl border border-line bg-[#FCFCFD] p-2.5">
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: DOT[s] }} />
                <span className="text-[12.5px] font-semibold text-ink">{RFQ_STATUS_LABEL[s]}</span>
                <span className="ml-auto text-[11px] text-faint">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map((c) => (
                  <RfqCardView key={c.id} card={c} />
                ))}
                {col.length === 0 && <div className="px-1 py-6 text-center text-xs text-faint">Nothing here</div>}
              </div>
            </div>
          );
        })}
      </div>

      {lost.length > 0 && (
        <details className="rounded-xl border border-line bg-[#FCFCFD] p-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-ink-2">
            Lost / cancelled <span className="text-faint">({lost.length})</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            {lost.map((c) => (
              <RfqCardView key={c.id} card={c} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function RfqCardView({ card }: { card: RfqCard }) {
  return (
    <Link
      href={`/admin/rfqs/${card.id}`}
      className={`block rounded-lg border border-line bg-card p-3 transition-colors hover:border-faint ${card.status === "lost" ? "opacity-75" : ""}`}
    >
      <div className="text-[13px] font-semibold leading-snug text-ink">{card.title}</div>
      <div className="mt-0.5 truncate text-xs text-muted">
        {card.clientLabel}
        {card.requestedBy && <span className="text-faint"> · from {card.requestedBy}</span>}
      </div>
      {card.tag && (
        <div className="mt-2.5">
          <span className={`rounded px-1.5 py-0.5 text-[11px] ${TAG_CLASS[card.tag.tone]}`}>{card.tag.text}</span>
        </div>
      )}
    </Link>
  );
}
