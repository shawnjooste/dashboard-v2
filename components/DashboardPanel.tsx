import Link from "next/link";
import type { DashItem } from "@/lib/views/admin-dashboard";

type ViewAll = { label: string; href: string; external?: boolean };

/** A uniform admin-overview panel: title + count pill, the top few items, and
 *  a "view all" footer (or a muted "+N more" when there's no destination). */
export function DashboardPanel({
  title,
  count,
  hot,
  items,
  viewAll,
  empty,
}: {
  title: string;
  count: number;
  /** Tint the count pill red when the panel actually needs action. */
  hot?: boolean;
  items: DashItem[];
  viewAll?: ViewAll;
  empty: string;
}) {
  const remaining = count - items.length;

  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="flex items-center gap-2.5">
        <h3 className="flex-1 text-[15px] font-bold text-ink">{title}</h3>
        <span
          className={`rounded-full px-2 py-px text-[11.5px] font-semibold ${
            hot && count > 0 ? "bg-brand-tint text-[#B01218]" : "bg-line-soft text-ink-3"
          }`}
        >
          {count}
        </span>
      </div>

      {count === 0 ? (
        <p className="mt-3 text-[13px] text-faint">{empty}</p>
      ) : (
        <div className="mt-3 space-y-2.5">
          {items.map((it) => (
            <div key={it.id} className="min-w-0">
              {it.href ? (
                <Link href={it.href} className="block truncate text-[13px] font-medium text-ink-2 hover:text-brand">
                  {it.primary}
                </Link>
              ) : (
                <div className="truncate text-[13px] font-medium text-ink-2">{it.primary}</div>
              )}
              {it.secondary && <div className="truncate text-[12px] text-faint">{it.secondary}</div>}
            </div>
          ))}
        </div>
      )}

      {count > 0 && viewAll ? (
        <div className="mt-3.5">
          {viewAll.external ? (
            <a
              href={viewAll.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline"
            >
              {viewAll.label} <span aria-hidden>→</span>
            </a>
          ) : (
            <Link
              href={viewAll.href}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline"
            >
              {viewAll.label} <span aria-hidden>→</span>
            </Link>
          )}
        </div>
      ) : (
        count > 0 && remaining > 0 && (
          <p className="mt-3.5 text-[12px] text-faint">+{remaining} more</p>
        )
      )}
    </div>
  );
}
