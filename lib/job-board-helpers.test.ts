import { describe, it, expect } from "vitest";
import { dueState, placeCard, toDateString, boardDropIndex } from "./job-board-helpers";

describe("dueState", () => {
  it("is 'none' when there is no due date", () => {
    expect(dueState(null, "2026-07-27")).toBe("none");
  });
  it("is 'overdue' when the date has passed", () => {
    expect(dueState("2026-07-26", "2026-07-27")).toBe("overdue");
  });
  it("is 'due_soon' today and within two days", () => {
    expect(dueState("2026-07-27", "2026-07-27")).toBe("due_soon");
    expect(dueState("2026-07-29", "2026-07-27")).toBe("due_soon");
  });
  it("is 'none' further out than two days", () => {
    expect(dueState("2026-07-30", "2026-07-27")).toBe("none");
  });
  it("handles month and year boundaries", () => {
    expect(dueState("2026-08-01", "2026-07-31")).toBe("due_soon");
    expect(dueState("2025-12-31", "2026-01-01")).toBe("overdue");
  });
});

describe("placeCard", () => {
  it("inserts a new card at the top of a column", () => {
    expect(placeCard(["a", "b"], "x", 0)).toEqual([
      { id: "x", position: 0 },
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ]);
  });
  it("inserts into the middle", () => {
    expect(placeCard(["a", "b"], "x", 1)).toEqual([
      { id: "a", position: 0 },
      { id: "x", position: 1 },
      { id: "b", position: 2 },
    ]);
  });
  it("clamps an index past the end", () => {
    expect(placeCard(["a", "b"], "x", 99)).toEqual([
      { id: "a", position: 0 },
      { id: "b", position: 1 },
      { id: "x", position: 2 },
    ]);
  });
  it("clamps a negative index", () => {
    expect(placeCard(["a"], "x", -3)).toEqual([
      { id: "x", position: 0 },
      { id: "a", position: 1 },
    ]);
  });
  it("reorders within the same column without duplicating the moved card", () => {
    expect(placeCard(["a", "b", "c"], "c", 0)).toEqual([
      { id: "c", position: 0 },
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ]);
  });
  it("handles dropping into an empty column", () => {
    expect(placeCard([], "x", 0)).toEqual([{ id: "x", position: 0 }]);
  });
});

describe("boardDropIndex", () => {
  // Same-column moves: `destinationIds` is the column's current order,
  // INCLUDING the active card (it is already a member of that column).
  it("same-column downward: dragging onto a card below lands after it (bottom slot reachable)", () => {
    const idx = boardDropIndex(["A", "B", "C"], "A", { kind: "card", id: "C" }, true);
    expect(idx).toBe(2);
    expect(placeCard(["A", "B", "C"], "A", idx).map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("same-column upward: dragging onto a card above lands before it", () => {
    const idx = boardDropIndex(["A", "B", "C"], "C", { kind: "card", id: "A" }, true);
    expect(idx).toBe(0);
    expect(placeCard(["A", "B", "C"], "C", idx).map((p) => p.id)).toEqual(["C", "A", "B"]);
  });

  it("same-column adjacent swap downward", () => {
    const idx = boardDropIndex(["A", "B"], "A", { kind: "card", id: "B" }, true);
    expect(placeCard(["A", "B"], "A", idx).map((p) => p.id)).toEqual(["B", "A"]);
  });

  it("same-column adjacent swap upward", () => {
    const idx = boardDropIndex(["A", "B"], "B", { kind: "card", id: "A" }, true);
    expect(placeCard(["A", "B"], "B", idx).map((p) => p.id)).toEqual(["B", "A"]);
  });

  // Cross-column moves: `destinationIds` is the destination column's current
  // order, EXCLUDING the active card (it isn't a member of that column yet).
  it("cross-column drop onto a card inserts before that card", () => {
    const idx = boardDropIndex(["X", "Y"], "A", { kind: "card", id: "Y" }, false);
    expect(idx).toBe(1);
    expect(placeCard(["X", "Y"], "A", idx).map((p) => p.id)).toEqual(["X", "A", "Y"]);
  });

  it("drop onto an empty column shell appends", () => {
    const idx = boardDropIndex([], "A", { kind: "column" }, false);
    expect(idx).toBe(0);
    expect(placeCard([], "A", idx).map((p) => p.id)).toEqual(["A"]);
  });

  it("drop onto a populated column's shell appends last", () => {
    const idx = boardDropIndex(["X", "Y"], "A", { kind: "column" }, false);
    expect(idx).toBe(2);
    expect(placeCard(["X", "Y"], "A", idx).map((p) => p.id)).toEqual(["X", "Y", "A"]);
  });

  it("same-column drop onto the column's own shell appends last, excluding the active card itself", () => {
    const idx = boardDropIndex(["A", "B", "C"], "B", { kind: "column" }, true);
    expect(idx).toBe(2);
    expect(placeCard(["A", "B", "C"], "B", idx).map((p) => p.id)).toEqual(["A", "C", "B"]);
  });
});

describe("toDateString", () => {
  it("formats a date as YYYY-MM-DD in the business timezone", () => {
    // 22:30 UTC on 27 Jul is already 00:30 on 28 Jul in Johannesburg (UTC+2).
    expect(toDateString(new Date("2026-07-27T22:30:00Z"))).toBe("2026-07-28");
  });
  it("respects an explicit timezone", () => {
    expect(toDateString(new Date("2026-07-27T22:30:00Z"), "UTC")).toBe("2026-07-27");
  });
});
