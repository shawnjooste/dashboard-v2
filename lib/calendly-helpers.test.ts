import { describe, expect, it } from "vitest";
import { chunkWindows, normalizeCalendlySlots, slotLabel } from "./calendly-helpers";

describe("slotLabel", () => {
  it("renders SAST from a stored UTC slot", () => {
    expect(slotLabel("2026-07-27T06:00:00.000Z")).toBe("Mon 27 Jul, 08:00");
  });
});

describe("normalizeCalendlySlots", () => {
  const raw = [
    { start_time: "2026-08-03T10:00:00Z", status: "available" },
    { start_time: "2026-08-03T08:00:00Z", status: "available" },
    { start_time: "2026-08-03T09:00:00Z", status: "unavailable" },
    { start_time: "2026-08-03T08:00:00Z", status: "available" }, // dupe
  ];
  it("keeps available slots only, sorted, deduped, normalized ISO", () => {
    const slots = normalizeCalendlySlots(raw);
    expect(slots.map((s) => s.iso)).toEqual(["2026-08-03T08:00:00.000Z", "2026-08-03T10:00:00.000Z"]);
  });
  it("labels in SAST", () => {
    expect(normalizeCalendlySlots(raw)[1].label).toBe("Mon 3 Aug, 12:00");
  });
  it("handles an empty collection", () => {
    expect(normalizeCalendlySlots([])).toEqual([]);
  });
});

describe("chunkWindows", () => {
  it("splits a 14-day range into 7-day windows", () => {
    const w = chunkWindows(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-15T00:00:00Z"), 7);
    expect(w).toEqual([
      { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      { start: "2026-08-08T00:00:00.000Z", end: "2026-08-15T00:00:00.000Z" },
    ]);
  });
  it("keeps a short range as one window", () => {
    const w = chunkWindows(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-04T00:00:00Z"), 7);
    expect(w).toHaveLength(1);
    expect(w[0].end).toBe("2026-08-04T00:00:00.000Z");
  });
});
