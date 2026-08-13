import Link from "next/link";
import type { NeedsYouItem } from "@/lib/needs-you";

const KIND_LABEL: Record<NeedsYouItem["kind"], string> = {
  payment: "Action required",
  quote: "Awaiting approval",
  agreement: "Signature needed",
  ticket: "Open ticket",
};

/** What's waiting on this person. Renders on phone and desktop alike — an
 *  empty state here is good news, so it reads as reassurance rather than as
 *  an error. */
export function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-card px-4 py-5">
        <p className="text-sm text-muted">
          Nothing needs your attention right now. We&rsquo;ll email you if that changes.
        </p>
      </div>
    );
  }

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.6px] text-faint">
        Needs you
      </h2>
      <div className="space-y-2.5">
        {items.map((item) => (
          <Link
            key={`${item.kind}-${item.href}`}
            href={item.href}
            className={`block rounded-lg border px-4 py-3.5 transition-colors ${
              item.urgent
                ? "border-warn-line bg-warn-tint hover:bg-warn-tint-2"
                : "border-line bg-card hover:border-faint"
            }`}
          >
            <span
              className={`text-[10.5px] font-semibold uppercase tracking-[0.4px] ${
                item.urgent ? "text-warn-ink" : "text-brand"
              }`}
            >
              {KIND_LABEL[item.kind]}
            </span>
            <p className="mt-1 text-[15px] font-semibold leading-snug text-ink">{item.title}</p>
            <p className="mt-0.5 text-[13px] text-muted">{item.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
