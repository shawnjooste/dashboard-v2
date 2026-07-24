import { describe, expect, it } from "vitest";
import {
  hashText, mapDattoAlert, mapDattoAvPosture, mapDattoPatchPosture,
  mapM365AccountDisabled, mapM365Identity, mapM365SecurityDefaults,
  mapNetworkDown, postureToResolve,
  refDattoAlert, refDattoAv, refM365Mfa, refNetworkDown,
} from "./severity-map.mjs";

describe("datto mappings", () => {
  it("maps alert priorities", () => {
    expect(mapDattoAlert("Critical")).toEqual({ category: "monitoring", severity: "critical" });
    expect(mapDattoAlert("High").severity).toBe("high");
    expect(mapDattoAlert("Moderate").severity).toBe("medium");
    expect(mapDattoAlert("Low").severity).toBe("low");
    expect(mapDattoAlert(null).severity).toBe("low");
  });
  it("AV off is a high config finding", () => {
    expect(mapDattoAvPosture()).toEqual({ category: "config", severity: "high" });
  });
  it("maps patch problems, ignores healthy states", () => {
    expect(mapDattoPatchPosture("InstallError")?.severity).toBe("medium");
    expect(mapDattoPatchPosture("Reboot Required")?.severity).toBe("low");
    expect(mapDattoPatchPosture("RebootRequired")?.severity).toBe("low");
    expect(mapDattoPatchPosture("Fully Patched")).toBeNull();
  });
});

describe("m365 mappings", () => {
  it("no methods at all is critical, weak methods high", () => {
    expect(mapM365Identity([]).severity).toBe("critical");
    expect(mapM365Identity(["sms"]).severity).toBe("high");
  });
  it("security defaults + disabled accounts map", () => {
    expect(mapM365SecurityDefaults().severity).toBe("medium");
    expect(mapM365AccountDisabled().category).toBe("identity");
  });
});

describe("network mapping", () => {
  it("offline and alerting are availability events, online is not", () => {
    expect(mapNetworkDown("offline")?.category).toBe("availability");
    expect(mapNetworkDown("alerting")?.severity).toBe("medium");
    expect(mapNetworkDown("online")).toBeNull();
  });
});

describe("source refs", () => {
  it("datto alert refs key on the stable alert_policy, not the drifting message", () => {
    const a = refDattoAlert("uid1", "2026-07-01T00:00:00Z", "diskUsage");
    expect(a).toBe(refDattoAlert("uid1", "2026-07-01T00:00:00Z", "diskUsage"));
    expect(a).not.toBe(refDattoAlert("uid1", "2026-07-01T00:00:00Z", "avStatus"));
    expect(refDattoAv("uid1")).not.toBe(refM365Mfa("uid1"));
  });
  it("network-down refs change only when last_seen_at advances (new outage)", () => {
    const down1 = refNetworkDown("dev-9", "2026-07-01T00:00:00Z");
    expect(down1).toContain("dev-9");
    expect(down1).toBe(refNetworkDown("dev-9", "2026-07-01T00:00:00Z")); // still down, same ref
    expect(down1).not.toBe(refNetworkDown("dev-9", "2026-07-05T00:00:00Z")); // recovered then dropped again
  });
  it("hashText is deterministic", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });
});

describe("postureToResolve", () => {
  it("returns refs open in db but gone from source", () => {
    expect(postureToResolve(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });
  it("empty db → nothing to resolve", () => {
    expect(postureToResolve([], ["x"])).toEqual([]);
  });
});
