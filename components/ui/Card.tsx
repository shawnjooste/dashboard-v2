import { type ReactNode } from "react";
import Link from "next/link";

/** Bordered white card (radius 8). Inner dividers use border-line-soft. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-lg border border-line bg-card ${className}`}>
      {children}
    </div>
  );
}

/** Card header row: 13.5px/600 title, optional count pill and a right-side link or action. */
export function CardHeader({
  title,
  count,
  href,
  action,
}: {
  title: ReactNode;
  count?: number | string;
  href?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line-soft px-4 py-[11px]">
      <span className="text-[13.5px] font-semibold text-ink-2">{title}</span>
      {count != null && (
        <span className="rounded-full bg-line-soft px-2 py-px text-[11.5px] font-semibold text-ink-3">
          {count}
        </span>
      )}
      {action && <div className="ml-auto">{action}</div>}
      {!action && href && (
        <Link
          href={href}
          className="ml-auto rounded-md px-1.5 py-0.5 text-sm text-muted hover:bg-line-soft hover:text-ink"
        >
          →
        </Link>
      )}
    </div>
  );
}
