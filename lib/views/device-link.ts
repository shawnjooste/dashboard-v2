export type SuggestPerson = { id: string; email: string; name: string };
export type DeviceForLink = { lastUser: string | null; label: string | null };

const localOf = (u: string) => u.split(/[\\@]/).pop()!.toLowerCase().trim();
const firstName = (name: string | null) => (name ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";

/**
 * Best-guess Person for a device from its last Windows login (fuzzy) and the
 * Datto user label. Returns null below a confidence floor — a suggestion, never
 * an auto-link.
 */
export function suggestPerson(
  device: DeviceForLink,
  people: SuggestPerson[],
): { person: SuggestPerson; score: number } | null {
  const u = device.lastUser ? localOf(device.lastUser) : "";
  const lbl = (device.label ?? "").trim().toLowerCase();
  let best: { person: SuggestPerson; score: number } | null = null;
  for (const p of people) {
    const pLocal = p.email.split("@")[0].toLowerCase();
    const pFirst = firstName(p.name);
    let score = 0;
    if (u && pLocal === u) score = 100;
    else if (u && pLocal.length >= 3 && u.startsWith(pLocal)) score = 85;
    else if (u && u.length >= 3 && pLocal.startsWith(u)) score = 75;
    else if (lbl && pFirst && pFirst === lbl) score = 60;
    if (score > (best?.score ?? 0)) best = { person: p, score };
  }
  return best && best.score >= 60 ? best : null;
}

export type DeviceLinkRow = {
  id: string;
  hostname: string;
  lastUser: string | null;
  personId: string | null;
  suggestedId: string | null;
};
