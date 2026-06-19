"use client";

/** Prints the quote document — the print CSS hides the sidebar, so this yields
 *  the same A4 PDF managers/members get from their view. */
export function PrintQuoteButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="w-full rounded-lg border border-line bg-card px-3.5 py-2.5 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-line-soft"
    >
      Print / Save PDF
    </button>
  );
}
