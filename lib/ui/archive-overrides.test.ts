import { describe, expect, it } from "vitest";
import { applyArchived } from "./archive-overrides";

const rows = [
  { id: "a", name: "Alpha", archived: false },
  { id: "b", name: "Beta", archived: false },
  { id: "c", name: "Gamma", archived: true },
];

describe("applyArchived", () => {
  it("returns the rows untouched when there are no overrides", () => {
    expect(applyArchived(rows, {})).toEqual(rows);
  });

  it("flips only the overridden row", () => {
    const out = applyArchived(rows, { b: true });
    expect(out.find((r) => r.id === "b")!.archived).toBe(true);
    expect(out.find((r) => r.id === "a")!.archived).toBe(false);
    expect(out.find((r) => r.id === "c")!.archived).toBe(true);
  });

  it("can restore an archived row", () => {
    expect(applyArchived(rows, { c: false }).find((r) => r.id === "c")!.archived).toBe(false);
  });

  it("ignores overrides for rows that aren't present", () => {
    expect(applyArchived(rows, { zzz: true })).toHaveLength(3);
  });

  it("does not mutate the input rows", () => {
    applyArchived(rows, { a: true });
    expect(rows[0].archived).toBe(false);
  });
});
