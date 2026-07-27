import { describe, it, expect } from "vitest";
import { dueState, placeCard, toDateString } from "./job-board-helpers";

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

describe("toDateString", () => {
  it("formats a date as YYYY-MM-DD in the business timezone", () => {
    // 22:30 UTC on 27 Jul is already 00:30 on 28 Jul in Johannesburg (UTC+2).
    expect(toDateString(new Date("2026-07-27T22:30:00Z"))).toBe("2026-07-28");
  });
  it("respects an explicit timezone", () => {
    expect(toDateString(new Date("2026-07-27T22:30:00Z"), "UTC")).toBe("2026-07-27");
  });
});
