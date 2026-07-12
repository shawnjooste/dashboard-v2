import { describe, expect, it } from "vitest";
import { fmtMinutes, monthKey, resolvePackage, usedMinutesInMonth } from "./support-package-helpers";

describe("monthKey", () => {
  it("formats a date as YYYY-MM", () => {
    expect(monthKey(new Date("2026-07-14T10:00:00Z"))).toBe("2026-07");
  });
  it("pads single-digit months", () => {
    expect(monthKey(new Date("2026-03-31T23:00:00Z"))).toBe("2026-03");
  });
});

describe("usedMinutesInMonth", () => {
  const entries = [
    { occurred_on: "2026-07-01", minutes: 30 },
    { occurred_on: "2026-07-14", minutes: 45 },
    { occurred_on: "2026-06-30", minutes: 500 },
  ];
  it("sums only the given month", () => {
    expect(usedMinutesInMonth(entries, "2026-07")).toBe(75);
  });
  it("is zero for an empty month", () => {
    expect(usedMinutesInMonth(entries, "2026-01")).toBe(0);
  });
});

describe("fmtMinutes", () => {
  it("formats whole hours", () => {
    expect(fmtMinutes(300)).toBe("5h");
  });
  it("formats hours and minutes", () => {
    expect(fmtMinutes(320)).toBe("5h 20m");
  });
  it("formats minutes only", () => {
    expect(fmtMinutes(45)).toBe("45m");
  });
  it("formats zero", () => {
    expect(fmtMinutes(0)).toBe("0m");
  });
});

describe("resolvePackage", () => {
  const pkgs = [
    { id: "a", is_default: true },
    { id: "b", is_default: false },
  ];
  it("returns the assigned package", () => {
    expect(resolvePackage(pkgs, "b")?.id).toBe("b");
  });
  it("falls back to the default when unassigned", () => {
    expect(resolvePackage(pkgs, null)?.id).toBe("a");
  });
  it("falls back to the default when the id is stale", () => {
    expect(resolvePackage(pkgs, "gone")?.id).toBe("a");
  });
  it("returns null when there are no packages at all", () => {
    expect(resolvePackage([], null)).toBeNull();
  });
});
