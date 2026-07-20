import { describe, expect, it } from "vitest";
import { mapLibrenmsDevice, speedLabel, KIND_LABELS } from "./connectivity-helpers";

describe("speedLabel", () => {
  it("formats down/up", () => {
    expect(speedLabel(100, 50)).toBe("100/50 Mbps");
  });
  it("formats download-only", () => {
    expect(speedLabel(100, null)).toBe("100 Mbps");
  });
  it("null when unknown", () => {
    expect(speedLabel(null, null)).toBeNull();
  });
});

describe("mapLibrenmsDevice", () => {
  const NOW = 1_760_000_000_000; // fixed ms epoch for downSince math
  it("maps an up device", () => {
    expect(mapLibrenmsDevice({ status: 1 }, NOW)).toEqual({ up: true, downSince: null });
  });
  it("maps a down device with downtime seconds", () => {
    const r = mapLibrenmsDevice({ status: 0, downtime: 3600 }, NOW);
    expect(r.up).toBe(false);
    expect(r.downSince).toBe(new Date(NOW - 3600 * 1000).toISOString());
  });
  it("down without downtime info", () => {
    expect(mapLibrenmsDevice({ status: 0 }, NOW)).toEqual({ up: false, downSince: null });
  });
  it("malformed payload degrades to unknown", () => {
    expect(mapLibrenmsDevice(null, NOW)).toEqual({ up: null, downSince: null });
    expect(mapLibrenmsDevice({ nope: true }, NOW)).toEqual({ up: null, downSince: null });
  });
});

describe("KIND_LABELS", () => {
  it("labels every kind", () => {
    for (const k of ["fibre", "wireless", "lte", "other"]) expect(KIND_LABELS[k]).toBeTruthy();
  });
});
