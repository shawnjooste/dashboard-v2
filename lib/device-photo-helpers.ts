/** Pure validation/naming helpers for device photos — no server imports (vitest-safe). */

export const MAX_PHOTO_BYTES = 10_000_000;

export function safePhotoName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Returns a human-readable error, or null when the file is an acceptable photo. */
export function photoError(file: { type: string; size: number; name: string }): string | null {
  if (!file.type.startsWith("image/")) return `${file.name}: not an image.`;
  if (file.size > MAX_PHOTO_BYTES) return `${file.name}: over the 10 MB limit.`;
  return null;
}

/** Vercel rejects serverless request bodies over 4.5 MB with a 413 before the
 *  server action runs, so each upload request must stay under that — 4 MB
 *  leaves headroom for multipart framing and the caption field. */
export const MAX_REQUEST_BYTES = 4_000_000;

/** Longest edge (px) a condition photo is downscaled to before upload. */
export const MAX_PHOTO_EDGE = 1920;

/** Scale (w, h) to fit within maxEdge, preserving aspect; never below 1px. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Greedily split files into consecutive chunks whose total size stays within
 *  limit. A single file over the limit still gets its own chunk — callers must
 *  filter those out first (sending one would hit the platform's opaque 413). */
export function chunkBySize<T extends { size: number }>(files: T[], limit: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let total = 0;
  for (const file of files) {
    if (current.length && total + file.size > limit) {
      chunks.push(current);
      current = [];
      total = 0;
    }
    current.push(file);
    total += file.size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
