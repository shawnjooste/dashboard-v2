import { type ReactNode } from "react";

/** Three-state health used across every surface. */
export type Health = "good" | "warn" | "bad";

export function statusStyle(h: Health): { dot: string; text: string; tint: string } {
  return {
    good: { dot: "bg-good-dot", text: "text-good", tint: "bg-good-tint" },
    warn: { dot: "bg-warn", text: "text-warn", tint: "bg-warn-tint" },
    bad: { dot: "bg-brand", text: "text-brand", tint: "bg-brand-tint" },
  }[h];
}

/** Dot + label, the standard inline status. */
export function StatusPill({ tone, label }: { tone: Health; label: ReactNode }) {
  const s = statusStyle(tone);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-[7px] w-[7px] rounded-full ${s.dot}`} />
      <span className={`text-[12.5px] font-medium ${s.text}`}>{label}</span>
    </span>
  );
}

/** Rounded status badge (pill with tinted background), used in detail headers. */
export function StatusBadge({ tone, label }: { tone: Health; label: ReactNode }) {
  const s = statusStyle(tone);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${s.tint}`}>
      <span className={`h-[7px] w-[7px] rounded-full ${s.dot}`} />
      <span className={`text-[12.5px] font-semibold ${s.text}`}>{label}</span>
    </span>
  );
}

/** Amber inline notice used in expanded rows. */
export function WarnNote({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-warn-line bg-warn-tint-2 px-3 py-2 text-[12.5px] font-medium text-warn-ink">
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-warn" />
      <span>{children}</span>
    </div>
  );
}
