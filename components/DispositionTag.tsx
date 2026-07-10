export const DISPOSITION_LABELS: Record<string, string> = {
  in_use: "In use",
  spare: "Spare",
  awaiting_repair: "Awaiting repair",
  to_remove: "Flag for removal",
};

const TONE: Record<string, string> = {
  spare: "bg-line-soft text-ink-3",
  awaiting_repair: "bg-warn-tint text-warn-ink",
  to_remove: "bg-brand-tint text-brand",
};

/** Small lifecycle tag; renders nothing for the default in-use state. */
export function DispositionTag({ disposition }: { disposition: string }) {
  if (disposition === "in_use") return null;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE[disposition] ?? "bg-line-soft text-ink-3"}`}>
      {DISPOSITION_LABELS[disposition] ?? disposition}
    </span>
  );
}
