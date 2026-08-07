/** Pure markdown → block parser for agreements. No imports (vitest-safe).
 *
 *  This is the ONLY parser: its output renders the on-screen agreement AND
 *  draws the PDF, so what a client reads is provably what they signed.
 *  Deliberately a small subset — agreements are prose, not brochures — and
 *  anything unsupported degrades to plain text rather than throwing, because
 *  an odd character must never block a signature.
 */

export type Run = { text: string; bold: boolean };
export type Block = { kind: "h1" | "h2" | "h3" | "p" | "bullet" | "number"; runs: Run[] };

export function blockText(b: Block): string {
  return b.runs.map((r) => r.text).join("");
}

/** Split on **bold**; an unmatched marker stays literal. */
function toRuns(text: string): Run[] {
  const runs: Run[] = [];
  let rest = text;
  for (;;) {
    const open = rest.indexOf("**");
    if (open === -1) break;
    const close = rest.indexOf("**", open + 2);
    if (close === -1) break; // dangling marker — leave it literal
    if (open > 0) runs.push({ text: rest.slice(0, open), bold: false });
    const inner = rest.slice(open + 2, close);
    if (inner) runs.push({ text: inner, bold: true });
    rest = rest.slice(close + 2);
  }
  if (rest) runs.push({ text: rest, bold: false });
  return runs.length ? runs : [{ text, bold: false }];
}

export function markdownToBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];

  const flush = () => {
    if (!para.length) return;
    blocks.push({ kind: "p", runs: toRuns(para.join(" ")) });
    para = [];
  };

  for (const raw of (md ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: `h${h[1].length}` as Block["kind"], runs: toRuns(h[2].trim()) });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ kind: "bullet", runs: toRuns(bullet[1].trim()) });
      continue;
    }
    const num = /^\d+[.)]\s+(.*)$/.exec(line);
    if (num) {
      flush();
      blocks.push({ kind: "number", runs: toRuns(num[1].trim()) });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
