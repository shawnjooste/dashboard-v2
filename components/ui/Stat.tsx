import { type ReactNode } from "react";
import Link from "next/link";
import { Card, CardHeader } from "./Card";

export type StatTone = "brand" | "good" | "warn" | "muted";

export type StatCell = {
  label: string;
  value: ReactNode;
  /** Sub-line under the value. */
  foot?: ReactNode;
  footTone?: StatTone;
  /** Optional sparkline or other node rendered below the value. */
  extra?: ReactNode;
};

const TONE: Record<StatTone, string> = {
  brand: "text-brand",
  good: "text-good",
  warn: "text-warn",
  muted: "text-faint",
};

function Cell({ cell, divider }: { cell: StatCell; divider?: boolean }) {
  const colored = cell.footTone && cell.footTone !== "muted";
  return (
    <div className={`px-4 pb-4 pt-3.5 ${divider ? "border-r border-line-soft" : ""}`}>
      <div className="text-[12.5px] text-muted">{cell.label}</div>
      <div className="mt-1 text-2xl font-bold leading-none text-ink">{cell.value}</div>
      {cell.extra}
      {cell.foot != null && (
        <div
          className={`mt-[3px] text-xs ${colored ? `font-semibold ${TONE[cell.footTone!]}` : "text-faint"}`}
        >
          {cell.foot}
        </div>
      )}
    </div>
  );
}

/** Overview stat card: title header + a two-up split of cells.
 *  With `href`, the whole card is a link. */
export function StatCard({
  title,
  left,
  right,
  href,
}: {
  title: string;
  left: StatCell;
  right: StatCell;
  href?: string;
}) {
  const inner = (
    <>
      <CardHeader title={title} action={href ? <span className="text-sm text-faint">→</span> : undefined} />
      <div className="grid grid-cols-2">
        <Cell cell={left} divider />
        <Cell cell={right} />
      </div>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block overflow-hidden rounded-lg border border-line bg-card transition-colors hover:border-faint"
      >
        {inner}
      </Link>
    );
  }
  return <Card>{inner}</Card>;
}

/** Responsive 3-up row of stat cards. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

/** A muted denominator, e.g. 11 <span>/ 12</span>. */
export function Denominator({ children }: { children: ReactNode }) {
  return <span className="text-sm font-medium text-muted">{children}</span>;
}
