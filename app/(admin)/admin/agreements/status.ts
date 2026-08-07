/** Status vocabulary shared by the staff list, the staff detail page and the
 *  client surface, so one agreement never reads differently in two places. */
export const AGREEMENT_STATUSES = ["draft", "sent", "signed", "void"] as const;

export const STATUS_STYLE: Record<string, string> = {
  draft: "bg-line-soft text-ink-3",
  sent: "bg-warn-tint text-warn-ink",
  signed: "bg-good-tint text-good",
  void: "bg-line-soft text-faint line-through",
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Awaiting signature",
  signed: "Signed",
  void: "Void",
};
