import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { markdownToBlocks, type Block } from "./markdown-blocks";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const BODY = 11;
const LEADING = 1.45;

type Fonts = { regular: PDFFont; bold: PDFFont };
type Part = { text: string; bold: boolean };

const sizeFor = (k: Block["kind"]) => (k === "h1" ? 19 : k === "h2" ? 15 : k === "h3" ? 12.5 : BODY);
const gapBefore = (k: Block["kind"]) => (k === "h1" ? 20 : k === "h2" ? 16 : k === "h3" ? 12 : 8);

/** Greedy wrap of a block's runs into lines that fit `width`. */
function wrap(block: Block, fonts: Fonts, size: number, width: number): Part[][] {
  const lines: Part[][] = [[]];
  let used = 0;
  for (const run of block.runs) {
    const font = run.bold ? fonts.bold : fonts.regular;
    for (const word of run.text.split(/(\s+)/)) {
      if (!word) continue;
      const w = font.widthOfTextAtSize(word, size);
      if (used + w > width && used > 0) {
        lines.push([]);
        used = 0;
        if (/^\s+$/.test(word)) continue; // don't start a line with the wrap space
      }
      lines[lines.length - 1].push({ text: word, bold: run.bold });
      used += w;
    }
  }
  return lines;
}

/** The agreement as a PDF: body from the same parser the screen uses, plus a
 *  signature certificate. Generated once at signing and stored — never
 *  re-rendered later, so the file always matches what was downloaded. */
export async function buildAgreementPdf(input: {
  reference: string;
  title: string;
  bodyMd: string;
  clientName: string;
  signerName: string;
  signerEmail: string;
  signedAt: string;
  signerIp: string | null;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.reference} — ${input.title}`);
  doc.setAuthor("Rocking (Pty) Ltd");
  doc.setSubject(`Agreement ${input.reference} signed by ${input.signerName}`);
  // Stamp the document dates with the signature time, not "now". The row is
  // frozen, so regenerating this PDF later must produce the identical file
  // rather than one that looks freshly authored.
  const signedOn = new Date(input.signedAt);
  doc.setCreationDate(signedOn);
  doc.setModificationDate(signedOn);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const pages: PDFPage[] = [];
  let page = doc.addPage(A4);
  pages.push(page);
  let y = A4[1] - MARGIN;
  const maxWidth = A4[0] - MARGIN * 2;

  const newPage = () => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - MARGIN;
  };

  const drawLine = (parts: Part[], size: number, xOffset = 0) => {
    if (y < MARGIN + 60) newPage();
    let x = MARGIN + xOffset;
    for (const p of parts) {
      const font = p.bold ? fonts.bold : fonts.regular;
      page.drawText(p.text, { x, y, size, font, color: rgb(0.09, 0.09, 0.11) });
      x += font.widthOfTextAtSize(p.text, size);
    }
    y -= size * LEADING;
  };

  // Title block
  drawLine([{ text: input.title, bold: true }], 22);
  y -= 4;
  drawLine([{ text: `${input.reference} · ${input.clientName}`, bold: false }], 10);
  y -= 14;

  for (const block of markdownToBlocks(input.bodyMd)) {
    const size = sizeFor(block.kind);
    y -= gapBefore(block.kind);
    const isList = block.kind === "bullet" || block.kind === "number";
    // The marker leads the first line; continuation lines hang underneath the
    // text rather than sliding back to the margin, so a long clause still
    // reads as one numbered item.
    const marker = block.kind === "bullet" ? "•  " : block.kind === "number" ? `${block.marker ?? "."}  ` : "";
    const indent = isList ? fonts.regular.widthOfTextAtSize(marker, size) : 0;
    const lines = wrap(block, fonts, size, maxWidth - indent);
    lines.forEach((parts, i) => {
      if (!parts.length) return;
      const prefix: Part[] = i === 0 && isList ? [{ text: marker, bold: false }] : [];
      const headed = block.kind.startsWith("h");
      drawLine(
        [...prefix, ...parts.map((p) => ({ ...p, bold: p.bold || headed }))],
        size,
        i === 0 ? 0 : indent,
      );
    });
  }

  // Signature certificate — always starts on a fresh page so it can't be
  // half-orphaned at the bottom of the last body page.
  newPage();
  drawLine([{ text: "Signature", bold: true }], 15);
  y -= 10;
  const when = new Date(input.signedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
  const certLines = [
    `Signed electronically on ${when} (SAST)`,
    `by ${input.signerName} (${input.signerEmail})`,
    `for ${input.clientName}`,
    `Issued by Rocking (Pty) Ltd`,
    `Reference ${input.reference}`,
    ...(input.signerIp ? [`IP address ${input.signerIp}`] : []),
  ];
  for (const line of certLines) drawLine([{ text: line, bold: false }], BODY);
  y -= 12;
  const note: Block = {
    kind: "p",
    runs: [
      {
        text: "This agreement was signed in the Rocking client portal, where the authoritative record is held.",
        bold: false,
      },
    ],
  };
  for (const line of wrap(note, fonts, 9.5, maxWidth)) drawLine(line, 9.5);

  // Footer on every page, once the total is known.
  pages.forEach((p, i) => {
    p.drawText(`${input.reference} · page ${i + 1} of ${pages.length}`, {
      x: MARGIN,
      y: MARGIN - 24,
      size: 8.5,
      font: fonts.regular,
      color: rgb(0.55, 0.55, 0.58),
    });
  });

  return doc.save();
}
