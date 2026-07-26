/** Pure grouping/ranking for the SOC console — no server imports
 *  (vitest-safe). "Which client is worst" is decided here and nowhere else. */

export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

export type SeverityCounts = Record<string, number>;

export type ClientRollup<T> = {
  clientId: string;
  clientName: string;
  counts: SeverityCounts;
  topItems: T[];
};

export function emptyCounts(): SeverityCounts {
  const c: SeverityCounts = {};
  for (const s of SEVERITY_ORDER) c[s] = 0;
  return c;
}

/** Lower is worse. Unknown severities sort last. */
export function severityRank(severity: string): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(severity);
  return i === -1 ? 99 : i;
}

/** Group open events by client, count by severity, keep the 3 worst items,
 *  and rank clients worst-first: more criticals wins; ties fall through to
 *  high, medium, low, info; a full tie sorts by client name. */
export function rollupByClient<T extends { clientId: string; clientName: string; severity: string }>(
  events: T[],
): ClientRollup<T>[] {
  const byClient = new Map<string, ClientRollup<T>>();
  for (const e of events) {
    let row = byClient.get(e.clientId);
    if (!row) {
      row = { clientId: e.clientId, clientName: e.clientName, counts: emptyCounts(), topItems: [] };
      byClient.set(e.clientId, row);
    }
    row.counts[e.severity] = (row.counts[e.severity] ?? 0) + 1;
    row.topItems.push(e);
  }
  for (const row of byClient.values()) {
    row.topItems.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    row.topItems = row.topItems.slice(0, 3);
  }
  return [...byClient.values()].sort((a, b) => {
    for (const s of SEVERITY_ORDER) {
      const diff = (b.counts[s] ?? 0) - (a.counts[s] ?? 0);
      if (diff !== 0) return diff;
    }
    return a.clientName.localeCompare(b.clientName);
  });
}
