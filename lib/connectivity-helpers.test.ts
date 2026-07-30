import { describe, expect, it } from "vitest";
import {
  mapLibrenmsDevice,
  speedLabel,
  KIND_LABELS,
  mapIcmp,
  nextDownSince,
  isStale,
  CONN_TYPE_LABELS,
} from "./connectivity-helpers";

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

describe("mapIcmp", () => {
  it("reads status + ping stats", () => {
    expect(mapIcmp({ status: 1, ping_avg: 12.4, ping_loss: 0 })).toEqual({ up: true, latencyMs: 12.4, lossPct: 0 });
  });
  it("reads a down device", () => {
    expect(mapIcmp({ status: 0, ping_avg: null, ping_loss: 100 })).toEqual({ up: false, latencyMs: null, lossPct: 100 });
  });
  it("tolerates string numbers", () => {
    expect(mapIcmp({ status: "1", ping_avg: "8.2", ping_loss: "0" })).toEqual({ up: true, latencyMs: 8.2, lossPct: 0 });
  });
  it("unknown when malformed", () => {
    expect(mapIcmp(null)).toEqual({ up: null, latencyMs: null, lossPct: null });
    expect(mapIcmp({ nope: 1 })).toEqual({ up: null, latencyMs: null, lossPct: null });
  });
  it("reads the real LibreNMS shape: boolean status + last_ping_timetaken", () => {
    expect(mapIcmp({ status: true, last_ping_timetaken: 0.442, ping_avg: null, ping_loss: null })).toEqual({
      up: true,
      latencyMs: 0.442,
      lossPct: null,
    });
    expect(mapIcmp({ status: false, last_ping_timetaken: 0 })).toEqual({ up: false, latencyMs: null, lossPct: null });
  });
});

describe("nextDownSince", () => {
  const NOW = "2026-07-24T10:00:00.000Z";
  it("stamps the start of an outage", () => {
    expect(nextDownSince(null, false, NOW)).toBe(NOW);
  });
  it("preserves the original outage start", () => {
    expect(nextDownSince("2026-07-24T08:00:00.000Z", false, NOW)).toBe("2026-07-24T08:00:00.000Z");
  });
  it("clears on recovery", () => {
    expect(nextDownSince("2026-07-24T08:00:00.000Z", true, NOW)).toBeNull();
  });
  it("leaves it untouched when the poll failed", () => {
    expect(nextDownSince("2026-07-24T08:00:00.000Z", null, NOW)).toBe("2026-07-24T08:00:00.000Z");
    expect(nextDownSince(null, null, NOW)).toBeNull();
  });
});

describe("isStale", () => {
  const NOW_MS = Date.parse("2026-07-24T10:00:00.000Z");
  it("never checked is stale", () => {
    expect(isStale(null, NOW_MS)).toBe(true);
  });
  it("fresh within 20 minutes", () => {
    expect(isStale("2026-07-24T09:50:00.000Z", NOW_MS)).toBe(false);
  });
  it("stale beyond 20 minutes", () => {
    expect(isStale("2026-07-24T09:30:00.000Z", NOW_MS)).toBe(true);
  });
});

describe("CONN_TYPE_LABELS", () => {
  it("labels each type", () => {
    expect(CONN_TYPE_LABELS.pppoe).toBe("PPPoE");
    expect(CONN_TYPE_LABELS.static).toBe("Static IP");
    expect(CONN_TYPE_LABELS.dhcp).toBe("Automatic (DHCP)");
  });
});
