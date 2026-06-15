// Stable per-client avatar colour + initials, shared by the admin Users and
// Clients lists so a given client always reads the same on both surfaces.

export const CLIENT_COLORS = [
  "#4F46E5", "#D7141C", "#0D9488", "#B45309", "#7C3AED",
  "#0E7490", "#BE185D", "#15803D", "#A16207", "#6D28D9",
];

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return h;
}

export function clientColor(name: string): string {
  return CLIENT_COLORS[hashString(name) % CLIENT_COLORS.length];
}

/** "GSR Law" → "GSR" (leading acronym), "Harbour & Co" → "HC". */
export function clientInitials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (words[0] && words[0].length <= 4 && words[0] === words[0].toUpperCase()) return words[0];
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
