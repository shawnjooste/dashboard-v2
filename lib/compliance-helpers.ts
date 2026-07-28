/** Pure validation/naming helpers for compliance documents — no server imports (vitest-safe). */

/** Vercel rejects serverless request bodies over 4.5 MB with a 413 before the
 *  server action runs. Unlike photos, a PDF can't be downscaled client-side,
 *  so the cap has to sit below the platform limit. */
export const MAX_DOC_BYTES = 4_000_000;

export function safeDocName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Returns a human-readable error, or null when the file is an acceptable PDF. */
export function documentError(file: { type: string; size: number; name: string }): string | null {
  const isPdf = file.type === "application/pdf" && /\.pdf$/i.test(file.name);
  if (!isPdf) return `${file.name}: only PDF files are allowed.`;
  if (file.size <= 0) return `${file.name}: the file is empty.`;
  if (file.size > MAX_DOC_BYTES) return `${file.name}: over the 4 MB limit — compress it or split it.`;
  return null;
}
