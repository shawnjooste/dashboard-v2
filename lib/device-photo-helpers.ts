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
