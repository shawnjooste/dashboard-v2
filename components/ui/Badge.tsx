import { type ReactNode } from "react";

/** Small neutral count pill, e.g. a row count next to a card title. */
export function CountPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-line-soft px-2 py-px text-[11.5px] font-semibold text-ink-3">
      {children}
    </span>
  );
}

/** Square-ish category tag (light gray chip), e.g. activity category. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-line-soft px-[7px] py-0.5 text-[11.5px] text-muted">{children}</span>
  );
}

/** Uppercase column-header / field label. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
      {children}
    </div>
  );
}
