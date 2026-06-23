import { describe, it, expect } from "vitest";
import { reorderSwap } from "./job-task-helpers";

const tasks = [
  { id: "a", position: 0 },
  { id: "b", position: 1 },
  { id: "c", position: 2 },
];

describe("reorderSwap", () => {
  it("swaps a task up with its neighbour", () => {
    expect(reorderSwap(tasks, "b", "up")).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
  });
  it("swaps a task down with its neighbour", () => {
    expect(reorderSwap(tasks, "a", "down")).toEqual([
      { id: "a", position: 1 },
      { id: "b", position: 0 },
    ]);
  });
  it("returns null at the ends", () => {
    expect(reorderSwap(tasks, "a", "up")).toBeNull();
    expect(reorderSwap(tasks, "c", "down")).toBeNull();
  });
  it("returns null for an unknown task", () => {
    expect(reorderSwap(tasks, "z", "up")).toBeNull();
  });
  it("is gap-safe — swaps stored position values regardless of contiguity", () => {
    const gappy = [
      { id: "a", position: 0 },
      { id: "b", position: 2 },
      { id: "c", position: 5 },
    ];
    expect(reorderSwap(gappy, "b", "down")).toEqual([
      { id: "b", position: 5 },
      { id: "c", position: 2 },
    ]);
  });
  it("orders by position even when input is unsorted", () => {
    const shuffled = [
      { id: "c", position: 2 },
      { id: "a", position: 0 },
      { id: "b", position: 1 },
    ];
    expect(reorderSwap(shuffled, "c", "up")).toEqual([
      { id: "c", position: 1 },
      { id: "b", position: 2 },
    ]);
  });
});
