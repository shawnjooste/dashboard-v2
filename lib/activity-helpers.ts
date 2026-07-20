/** Pure activity-feed logic — no server imports (vitest-safe). */

export const SECTION_LABELS: Record<string, string> = {
  home: "Account home",
  connectivity: "Connectivity",
  devices: "Devices",
  device: "a device",
  billing: "Billing",
  quotes: "Quotes",
  support: "Support",
  m365: "Microsoft 365",
  network: "Network",
  team: "Team",
  work: "Work",
  other: "the portal",
};

const SECTIONS = new Set(["connectivity", "devices", "billing", "quotes", "support", "m365", "network", "team", "work"]);

/** Client-surface pathname → section key for visit tracking. */
export function sectionFromPath(pathname: string): string {
  const [seg0, seg1] = pathname.replace(/^\/+/, "").split("/");
  if (!seg0) return "home";
  if (seg0 === "devices" && seg1) return "device";
  return SECTIONS.has(seg0) ? seg0 : "other";
}

/** A visit after >= 8 quiet hours (or no history) counts as a sign-in. */
export function isLoginGap(minutesSinceLast: number | null): boolean {
  return minutesSinceLast === null || minutesSinceLast >= 480;
}

/** Group desc-sorted items into day buckets (UTC calendar days). */
export function groupByDay<T extends { at: string }>(items: T[]): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = item.at.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
