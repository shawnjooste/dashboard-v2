import { describe, expect, it } from "vitest";
import { emptyCounts, rollupByClient, severityRank, SEVERITY_ORDER } from "./rollup";

const ev = (clientId: string, clientName: string, severity: string, title = "t") => ({
  clientId,
  clientName,
  severity,
  title,
});

describe("severityRank", () => {
  it("ranks critical worst and info least", () => {
    expect(severityRank("critical")).toBeLessThan(severityRank("high"));
    expect(severityRank("high")).toBeLessThan(severityRank("medium"));
    expect(severityRank("info")).toBeLessThan(severityRank("nonsense"));
  });
});

describe("emptyCounts", () => {
  it("has every severity at zero", () => {
    const c = emptyCounts();
    for (const s of SEVERITY_ORDER) expect(c[s]).toBe(0);
  });
});

describe("rollupByClient", () => {
  it("groups by client and counts by severity", () => {
    const rows = rollupByClient([
      ev("c1", "Alpha", "critical"),
      ev("c1", "Alpha", "high"),
      ev("c1", "Alpha", "high"),
      ev("c2", "Beta", "medium"),
    ]);
    const alpha = rows.find((r) => r.clientId === "c1")!;
    expect(alpha.counts.critical).toBe(1);
    expect(alpha.counts.high).toBe(2);
    expect(alpha.counts.medium).toBe(0);
    expect(rows.find((r) => r.clientId === "c2")!.counts.medium).toBe(1);
  });

  it("sorts worst-first: critical dominates any number of highs", () => {
    const rows = rollupByClient([
      ev("c2", "Beta", "high"),
      ev("c2", "Beta", "high"),
      ev("c2", "Beta", "high"),
      ev("c1", "Alpha", "critical"),
    ]);
    expect(rows[0].clientId).toBe("c1");
  });

  it("breaks ties on the next severity down, then on name", () => {
    const rows = rollupByClient([
      ev("c1", "Zulu", "critical"),
      ev("c2", "Alpha", "critical"),
      ev("c2", "Alpha", "high"),
      ev("c3", "Mike", "critical"),
    ]);
    // Alpha has an extra high → first; Zulu and Mike tie on counts → name order
    expect(rows.map((r) => r.clientName)).toEqual(["Alpha", "Mike", "Zulu"]);
  });

  it("caps topItems at 3, worst-first", () => {
    const rows = rollupByClient([
      ev("c1", "Alpha", "low", "l"),
      ev("c1", "Alpha", "critical", "c"),
      ev("c1", "Alpha", "medium", "m"),
      ev("c1", "Alpha", "high", "h"),
    ]);
    expect(rows[0].topItems.map((i) => i.title)).toEqual(["c", "h", "m"]);
  });

  it("handles empty input", () => {
    expect(rollupByClient([])).toEqual([]);
  });
});
