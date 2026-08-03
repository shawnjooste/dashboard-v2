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
  HOP_KINDS,
  HOP_KIND_LABELS,
  HOP_KIND_ICONS,
  connectorBroken,
  firstBreakIndex,
  linkState,
  pathSummary,
  groupHops,
  groupStateOf,
  hopStateOf,
  HOP_STATUS_WORD,
  type HopLike,
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

describe("path hops", () => {
  it("labels and icons every hop kind", () => {
    for (const k of HOP_KINDS) {
      expect(HOP_KIND_LABELS[k]).toBeTruthy();
      expect(HOP_KIND_ICONS[k]).toBeTruthy();
    }
  });

  it("a connector only breaks for a monitored hop that is down", () => {
    expect(connectorBroken({ up: false, monitored: true })).toBe(true);
    expect(connectorBroken({ up: true, monitored: true })).toBe(false);
    expect(connectorBroken({ up: null, monitored: true })).toBe(false);
    // an unmonitored hop is a label, never evidence of a fault
    expect(connectorBroken({ up: false, monitored: false })).toBe(false);
  });

  it("finds where the path breaks", () => {
    const hops = [
      { up: true, monitored: true },
      { up: true, monitored: true },
      { up: false, monitored: true },
      { up: false, monitored: true },
    ];
    expect(firstBreakIndex(hops)).toBe(2);
  });

  it("no break when everything is up or unmonitored", () => {
    expect(firstBreakIndex([{ up: true, monitored: true }, { up: null, monitored: false }])).toBeNull();
    expect(firstBreakIndex([])).toBeNull();
  });
});

describe("linkState", () => {
  const NOW = Date.parse("2026-08-02T17:10:00.000Z");
  const fresh = "2026-08-02T17:08:00.000Z";

  it("up and clean is up", () => {
    expect(linkState({ up: true, lossPct: 0, lastCheckedAt: fresh }, NOW)).toBe("up");
    expect(linkState({ up: true, lossPct: null, lastCheckedAt: fresh }, NOW)).toBe("up");
  });
  it("total loss is down even when the poller says up", () => {
    // the bug this exists to prevent: "Online · 100% packet loss"
    expect(linkState({ up: true, lossPct: 100, lastCheckedAt: fresh }, NOW)).toBe("down");
  });
  it("partial loss is degraded, not silently fine", () => {
    expect(linkState({ up: true, lossPct: 33, lastCheckedAt: fresh }, NOW)).toBe("degraded");
  });
  it("poller down is down", () => {
    expect(linkState({ up: false, lossPct: null, lastCheckedAt: fresh }, NOW)).toBe("down");
  });
  it("no recent check is stale, whatever the last values were", () => {
    expect(linkState({ up: true, lossPct: 0, lastCheckedAt: "2026-08-02T15:00:00.000Z" }, NOW)).toBe("stale");
    expect(linkState({ up: true, lossPct: 0, lastCheckedAt: null }, NOW)).toBe("stale");
  });
  it("unknown when we have a check but no verdict", () => {
    expect(linkState({ up: null, lossPct: null, lastCheckedAt: fresh }, NOW)).toBe("unknown");
  });
});

describe("pathSummary", () => {
  const NOW = Date.parse("2026-08-03T10:00:00.000Z");
  const fresh = "2026-08-03T09:58:00.000Z";
  const hop = (over: Partial<HopLike> = {}): HopLike => ({
    label: "Hop",
    librenmsDeviceId: 1,
    lastUp: true,
    latencyMs: 5,
    lastCheckedAt: fresh,
    ...over,
  });

  it("reports all clear when every hop is up", () => {
    const s = pathSummary([hop({ label: "A" }), hop({ label: "B", latencyMs: 9.1 })], NOW);
    expect(s.allOperational).toBe(true);
    expect(s.faultIndex).toBeNull();
    expect(s.e2eLatencyMs).toBe(9.1);
  });

  it("isolates the first break and confirms upstream is passing", () => {
    const s = pathSummary(
      [hop({ label: "Internet" }), hop({ label: "Core" }), hop({ label: "Edge", lastUp: false, latencyMs: null }), hop({ label: "CPE", lastUp: false })],
      NOW,
    );
    expect(s.faultIndex).toBe(2);
    expect(s.faultLabel).toBe("Edge");
    expect(s.upstreamPassing).toBe(true);
    expect(s.allOperational).toBe(false);
  });

  it("does not claim upstream is passing when the very first hop is down", () => {
    const s = pathSummary([hop({ label: "Internet", lastUp: false }), hop({ label: "Core" })], NOW);
    expect(s.faultIndex).toBe(0);
    expect(s.upstreamPassing).toBe(false);
  });

  it("has no end-to-end figure when the last hop isn't up", () => {
    expect(pathSummary([hop(), hop({ lastUp: false, latencyMs: null })], NOW).e2eLatencyMs).toBeNull();
    // unmonitored final hop: no reading, not a fault
    expect(pathSummary([hop(), hop({ librenmsDeviceId: null })], NOW).e2eLatencyMs).toBeNull();
  });

  it("treats an unmonitored or stale hop as idle, never as a fault", () => {
    const s = pathSummary([hop(), hop({ librenmsDeviceId: null }), hop({ lastCheckedAt: "2026-08-03T08:00:00.000Z" })], NOW);
    expect(s.faultIndex).toBeNull();
    expect(s.allOperational).toBe(false);
  });

  it("handles an empty path", () => {
    const s = pathSummary([], NOW);
    expect(s.allOperational).toBe(false);
    expect(s.faultIndex).toBeNull();
    expect(s.e2eLatencyMs).toBeNull();
  });

  // --- parallel legs: two devices hanging off one upstream are ONE step ---

  it("does not call a step down while one of its legs still answers", () => {
    const s = pathSummary(
      [
        hop({ label: "Mikrotik" }),
        hop({ label: "Downstream 1", lastUp: false, latencyMs: null }),
        hop({ label: "Downstream 2", parallelWithPrevious: true }),
      ],
      NOW,
    );
    expect(s.faultIndex).toBeNull();
    expect(s.degradedLabels).toEqual(["Downstream 1"]);
    expect(s.allOperational).toBe(false);
  });

  it("calls the step down only when every leg is down", () => {
    const s = pathSummary(
      [
        hop({ label: "Mikrotik" }),
        hop({ label: "Downstream 1", lastUp: false, latencyMs: null }),
        hop({ label: "Downstream 2", lastUp: false, latencyMs: null, parallelWithPrevious: true }),
      ],
      NOW,
    );
    expect(s.faultIndex).toBe(1); // step index, not hop index
    expect(s.faultLabel).toBe("Downstream 1 + Downstream 2");
    expect(s.upstreamPassing).toBe(true);
    expect(s.faultSince).toBe(fresh);
  });

  it("gives no end-to-end figure when the path ends in parallel legs", () => {
    const s = pathSummary([hop({ label: "A" }), hop({ label: "B" }), hop({ label: "C", parallelWithPrevious: true })], NOW);
    expect(s.allOperational).toBe(true);
    expect(s.e2eLatencyMs).toBeNull(); // no single "end" to measure to
  });

  it("an idle leg alongside an up leg leaves the step passing", () => {
    const s = pathSummary(
      [hop({ label: "A" }), hop({ label: "B" }), hop({ label: "C", librenmsDeviceId: null, parallelWithPrevious: true })],
      NOW,
    );
    expect(s.faultIndex).toBeNull();
    expect(s.degradedLabels).toEqual([]); // unmonitored is not a lost leg
    expect(s.allOperational).toBe(false);
  });
});

describe("groupHops", () => {
  const h = (label: string, parallelWithPrevious = false) => ({ label, parallelWithPrevious });

  it("keeps a plain chain as one hop per step", () => {
    expect(groupHops([h("A"), h("B"), h("C")]).map((g) => g.map((x) => x.label))).toEqual([["A"], ["B"], ["C"]]);
  });

  it("joins flagged hops to the step before them", () => {
    const g = groupHops([h("A"), h("B"), h("C", true), h("D", true), h("E")]);
    expect(g.map((s) => s.map((x) => x.label))).toEqual([["A"], ["B", "C", "D"], ["E"]]);
  });

  it("never lets the first hop be parallel with nothing", () => {
    expect(groupHops([h("A", true), h("B")]).map((g) => g.map((x) => x.label))).toEqual([["A"], ["B"]]);
  });

  it("handles an empty list", () => {
    expect(groupHops([])).toEqual([]);
  });
});

describe("groupStateOf", () => {
  it("passes when any leg is up", () => {
    expect(groupStateOf(["up"])).toBe("up");
    expect(groupStateOf(["up", "idle"])).toBe("up");
  });
  it("is degraded when a leg is lost but another holds", () => {
    expect(groupStateOf(["up", "down"])).toBe("degraded");
  });
  it("is down only when every leg is down", () => {
    expect(groupStateOf(["down", "down"])).toBe("down");
  });
  it("is idle with nothing to go on", () => {
    expect(groupStateOf(["idle", "idle"])).toBe("idle");
    expect(groupStateOf([])).toBe("idle");
  });
});
