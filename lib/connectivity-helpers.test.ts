import { describe, expect, it } from "vitest";
import {
  mapLibrenmsDevice,
  speedLabel,
  KIND_LABELS,
  mapIcmp,
  nextDownSince,
  isStale,
  CONN_TYPE_LABELS,
  deviceHost,
  parsePing,
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
  it("reads the real LibreNMS shape: boolean status, no usable latency", () => {
    // last_ping_timetaken is poller runtime, NOT round-trip time — ignoring it
    // is the point: reading it would report 0.4ms for a 53ms link.
    expect(mapIcmp({ status: true, last_ping_timetaken: 0.442, ping_avg: null, ping_loss: null })).toEqual({
      up: true,
      latencyMs: null,
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

describe("deviceHost", () => {
  it("returns the hostname LibreNMS monitors", () => {
    expect(deviceHost({ hostname: "102.176.237.94" })).toBe("102.176.237.94");
  });
  it("null when absent or malformed", () => {
    expect(deviceHost({})).toBeNull();
    expect(deviceHost(null)).toBeNull();
    expect(deviceHost({ hostname: "  " })).toBeNull();
  });
});

describe("parsePing", () => {
  const bsd = `3 packets transmitted, 3 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 53.102/53.712/54.521/0.596 ms`;
  const linux = `3 packets transmitted, 3 received, 0% packet loss, time 2003ms
rtt min/avg/max/mdev = 3.683/3.792/3.917/0.096 ms`;
  const dead = `3 packets transmitted, 0 packets received, 100.0% packet loss`;

  it("parses BSD (macOS) output", () => {
    expect(parsePing(bsd)).toEqual({ latencyMs: 53.712, lossPct: 0 });
  });
  it("parses Linux output", () => {
    expect(parsePing(linux)).toEqual({ latencyMs: 3.792, lossPct: 0 });
  });
  it("handles a dead host: loss without timings", () => {
    expect(parsePing(dead)).toEqual({ latencyMs: null, lossPct: 100 });
  });
  it("handles junk", () => {
    expect(parsePing("")).toEqual({ latencyMs: null, lossPct: null });
  });
});
