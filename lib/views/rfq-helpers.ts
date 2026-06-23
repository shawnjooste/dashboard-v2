// Pure RFQ helpers + shared types — no server imports, so this stays unit-testable
// and safe to pull into client components via `import type`.

export type RfqStatus = "new" | "sourcing" | "quoted" | "won" | "lost";

export const RFQ_STATUS_LABEL: Record<RfqStatus, string> = {
  new: "New",
  sourcing: "Sourcing",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};
/** Columns shown on the board, in order. `lost` lives off-board. */
export const BOARD_STATUSES: RfqStatus[] = ["new", "sourcing", "quoted", "won"];

export type CardTag = { text: string; tone: "warn" | "info" | "good" };

/** Display name = linked client's name, else the free-text prospect, else em-dash. */
export function rfqDisplayName(linkedClientName: string | null, prospectName: string | null): string {
  return linkedClientName ?? prospectName ?? "—";
}

/** The single tag shown on a board card: the sourcing note, or the linked quote number. */
export function rfqCardTag(status: RfqStatus, sourcingNote: string | null, quoteNumber: string | null): CardTag | null {
  if (status === "sourcing" && sourcingNote) return { text: sourcingNote, tone: "warn" };
  if ((status === "quoted" || status === "won") && quoteNumber) {
    return { text: quoteNumber, tone: status === "won" ? "good" : "info" };
  }
  return null;
}
