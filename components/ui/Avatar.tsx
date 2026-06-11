export function initials(name: string): string {
  const base = name.includes("@") ? name.split("@")[0] : name;
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  const letters = (parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)) || "?";
  return letters.toUpperCase();
}

/** Initials circle. */
export function Avatar({
  name,
  size = "md",
  tone = "neutral",
}: {
  name: string;
  size?: "sm" | "md";
  tone?: "neutral" | "dark";
}) {
  const sz = size === "sm" ? "h-6 w-6 text-[10px]" : "h-[30px] w-[30px] text-[11px]";
  const tn = tone === "dark" ? "bg-ink text-white" : "bg-line-soft text-ink-3";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${sz} ${tn}`}>
      {initials(name)}
    </span>
  );
}
