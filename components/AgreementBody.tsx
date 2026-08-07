import { markdownToBlocks, type Block } from "@/lib/agreements/markdown-blocks";

/** Renders an agreement from the SAME parser the PDF uses, so what a client
 *  reads on screen is provably what they signed. Never renders raw HTML —
 *  every run is plain text placed into elements we control. */
export function AgreementBody({ md }: { md: string }) {
  const blocks = markdownToBlocks(md);

  // Consecutive list blocks of the same kind become one list, so bullets and
  // numbered clauses group visually the way the author wrote them.
  const groups: { kind: Block["kind"]; blocks: Block[] }[] = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    const isList = b.kind === "bullet" || b.kind === "number";
    if (isList && last && last.kind === b.kind) last.blocks.push(b);
    else groups.push({ kind: b.kind, blocks: [b] });
  }

  const runs = (b: Block) =>
    b.runs.map((r, i) => (r.bold ? <strong key={i} className="font-semibold text-ink">{r.text}</strong> : <span key={i}>{r.text}</span>));

  return (
    <div className="max-w-[68ch] space-y-3">
      {groups.map((g, gi) => {
        const b = g.blocks[0];
        if (g.kind === "h1")
          return <h2 key={gi} className="mt-7 text-[22px] font-bold tracking-[-0.3px] text-ink first:mt-0">{runs(b)}</h2>;
        if (g.kind === "h2")
          return <h3 key={gi} className="mt-6 text-[17px] font-bold text-ink first:mt-0">{runs(b)}</h3>;
        if (g.kind === "h3")
          return <h4 key={gi} className="mt-5 text-[15px] font-semibold text-ink first:mt-0">{runs(b)}</h4>;
        if (g.kind === "bullet")
          return (
            <ul key={gi} className="space-y-1.5 pl-1">
              {g.blocks.map((item, i) => (
                <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-ink-2">
                  <span className="shrink-0 text-faint">•</span>
                  <span>{runs(item)}</span>
                </li>
              ))}
            </ul>
          );
        if (g.kind === "number")
          return (
            <ol key={gi} className="space-y-1.5 pl-1">
              {g.blocks.map((item, i) => (
                <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-ink-2">
                  {/* The author's own marker — clauses get referenced by number. */}
                  <span className="shrink-0 tabular-nums text-ink-3">{item.marker ?? "."}</span>
                  <span>{runs(item)}</span>
                </li>
              ))}
            </ol>
          );
        return <p key={gi} className="text-[15px] leading-relaxed text-ink-2">{runs(b)}</p>;
      })}
    </div>
  );
}
