import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, gwfShare, routerCell, stormVerdict } from "./ned-helpers";

const T0 = Date.parse("2026-08-19T15:00:00Z");

describe("stormVerdict", () => {
  it("returns the stored status while fresh", () => {
    expect(stormVerdict("2026-08-19T14:30:00Z", "active", T0)).toEqual({
      kind: "status",
      status: "active",
    });
  });

  it("passes through any stored status untouched (no re-derivation)", () => {
    expect(stormVerdict("2026-08-19T14:59:00Z", "cleared", T0)).toEqual({
      kind: "status",
      status: "cleared",
    });
  });

  it("is fresh at exactly the stale boundary, stale just past it", () => {
    const at = new Date(T0 - STALE_AFTER_MS).toISOString();
    expect(stormVerdict(at, "active", T0).kind).toBe("status");
    const past = new Date(T0 - STALE_AFTER_MS - 1).toISOString();
    expect(stormVerdict(past, "active", T0).kind).toBe("stale");
  });

  it("reports whole hours since the last capture when stale", () => {
    const past = new Date(T0 - 14.5 * 60 * 60 * 1000).toISOString();
    expect(stormVerdict(past, "cleared", T0)).toEqual({ kind: "stale", hoursAgo: 14 });
  });

  it("treats an unparseable timestamp as stale rather than crashing", () => {
    expect(stormVerdict("not-a-date", "active", T0).kind).toBe("stale");
  });
});

describe("gwfShare", () => {
  it("rounds to whole percent", () => {
    expect(gwfShare(62395, 66129)).toBe(94);
  });

  it("is null when arp_frames is zero (nothing to share)", () => {
    expect(gwfShare(0, 0)).toBeNull();
  });

  it("is null when arp_frames is negative (bad data, not 0%)", () => {
    expect(gwfShare(5, -1)).toBeNull();
  });
});

describe("routerCell", () => {
  it("both up → Up/good", () => {
    expect(routerCell("up", "up")).toEqual({ value: "Up", tone: "good" });
  });

  it("any down → Down/bad", () => {
    expect(routerCell("up", "down")).toEqual({ value: "Down", tone: "bad" });
    expect(routerCell("down", "up")).toEqual({ value: "Down", tone: "bad" });
  });

  it("unknown states → Unknown/warn (not silently Up)", () => {
    expect(routerCell("unknown", "up")).toEqual({ value: "Unknown", tone: "warn" });
  });
});
