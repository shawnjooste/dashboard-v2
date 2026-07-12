/** Pure support-package logic — no server imports (vitest-safe). */

/** "YYYY-MM" for the month containing d (UTC). */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Sum of minutes for entries whose occurred_on date falls in the keyed month. */
export function usedMinutesInMonth(
  entries: { occurred_on: string; minutes: number }[],
  key: string,
): number {
  return entries.filter((e) => e.occurred_on.startsWith(key)).reduce((n, e) => n + e.minutes, 0);
}

/** 320 → "5h 20m"; 300 → "5h"; 45 → "45m". */
export function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** The client's assigned package, else the default package, else null. */
export function resolvePackage<T extends { id: string; is_default: boolean }>(
  packages: T[],
  clientPackageId: string | null,
): T | null {
  return (
    (clientPackageId && packages.find((p) => p.id === clientPackageId)) ||
    packages.find((p) => p.is_default) ||
    null
  );
}
