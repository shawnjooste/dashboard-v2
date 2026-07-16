import { describe, expect, it } from "vitest";
import { jobNudge } from "./job-nudge";

const NOW = new Date("2026-07-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("jobNudge", () => {
  it("always surfaces waiting jobs, tagged with their note", () => {
    expect(jobNudge("waiting", "parts from Miro", daysAgo(0), NOW)).toEqual({ tag: "parts from Miro", rank: 0 });
  });
  it("falls back to a plain waiting tag", () => {
    expect(jobNudge("waiting", null, daysAgo(2), NOW)).toEqual({ tag: "waiting", rank: 0 });
  });
  it("surfaces open jobs untouched for 7+ days as stale", () => {
    expect(jobNudge("in_progress", null, daysAgo(12), NOW)).toEqual({ tag: "stale 12d", rank: 1 });
    expect(jobNudge("todo", null, daysAgo(7), NOW)).toEqual({ tag: "stale 7d", rank: 1 });
  });
  it("leaves fresh open jobs alone", () => {
    expect(jobNudge("in_progress", null, daysAgo(3), NOW)).toBeNull();
    expect(jobNudge("todo", null, daysAgo(6), NOW)).toBeNull();
  });
  it("never surfaces done or cancelled jobs", () => {
    expect(jobNudge("done", null, daysAgo(30), NOW)).toBeNull();
    expect(jobNudge("cancelled", "note", daysAgo(30), NOW)).toBeNull();
  });
});
