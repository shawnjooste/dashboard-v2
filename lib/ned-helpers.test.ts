import { describe, expect, it } from "vitest";
import {
  STALE_AFTER_MS,
  asList,
  fmtBytes,
  fmtUptime,
  gwfShare,
  parseNedDetails,
  routerCell,
  safeNum,
  safeStr,
  stormVerdict,
} from "./ned-helpers";

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

describe("parseNedDetails", () => {
  it("accepts any plain object (all keys are optional)", () => {
    expect(parseNedDetails({})).toEqual({});
    expect(parseNedDetails({ arp: { requests: 5 } })).toEqual({ arp: { requests: 5 } });
  });

  it("rejects null and undefined (old rows have details = null)", () => {
    expect(parseNedDetails(null)).toBeNull();
    expect(parseNedDetails(undefined)).toBeNull();
  });

  it("rejects non-object jsonb — arrays, strings, numbers, booleans", () => {
    expect(parseNedDetails([1, 2])).toBeNull();
    expect(parseNedDetails("storm")).toBeNull();
    expect(parseNedDetails(42)).toBeNull();
    expect(parseNedDetails(true)).toBeNull();
  });
});

describe("safeNum", () => {
  it("passes finite numbers through, including zero", () => {
    expect(safeNum(0)).toBe(0);
    expect(safeNum(12.5)).toBe(12.5);
    expect(safeNum(-3)).toBe(-3);
  });

  it("null for anything that is not a finite number", () => {
    expect(safeNum(NaN)).toBeNull();
    expect(safeNum(Infinity)).toBeNull();
    expect(safeNum("12")).toBeNull();
    expect(safeNum(null)).toBeNull();
    expect(safeNum(undefined)).toBeNull();
  });
});

describe("safeStr", () => {
  it("passes non-empty strings through", () => {
    expect(safeStr("arp")).toBe("arp");
  });

  it("null for empty strings and non-strings", () => {
    expect(safeStr("")).toBeNull();
    expect(safeStr(7)).toBeNull();
    expect(safeStr(null)).toBeNull();
    expect(safeStr(undefined)).toBeNull();
  });
});

describe("asList", () => {
  it("returns a fresh copy of an array (safe to sort in place)", () => {
    const src = [3, 1, 2];
    const got = asList(src);
    expect(got).toEqual([3, 1, 2]);
    got.sort();
    expect(src).toEqual([3, 1, 2]);
  });

  it("empty array for null and undefined", () => {
    expect(asList(null)).toEqual([]);
    expect(asList(undefined)).toEqual([]);
  });

  it("empty array for malformed jsonb smuggled through the cast", () => {
    expect(asList("not-an-array" as unknown as string[])).toEqual([]);
    expect(asList({ 0: "x" } as unknown as string[])).toEqual([]);
  });
});

describe("fmtBytes", () => {
  it("bytes under 1 KB render as B", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1023)).toBe("1023 B");
  });

  it("KB and MB with one decimal", () => {
    expect(fmtBytes(1024)).toBe("1.0 KB");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("drops the decimal at 100+ units", () => {
    expect(fmtBytes(100 * 1024)).toBe("100 KB");
    expect(fmtBytes(500 * 1024)).toBe("500 KB");
  });

  it("rolls up to the next unit before hitting 4 digits", () => {
    expect(fmtBytes(1_048_575)).toBe("1.0 MB"); // 1024.0 KB would be 4 digits
    expect(fmtBytes(3.5 * 1024 ** 3)).toBe("3.5 GB");
  });

  it("em-dash for missing, malformed or negative values", () => {
    expect(fmtBytes(null)).toBe("—");
    expect(fmtBytes(undefined)).toBe("—");
    expect(fmtBytes("12")).toBe("—");
    expect(fmtBytes(-1)).toBe("—");
    expect(fmtBytes(NaN)).toBe("—");
  });
});

describe("fmtUptime", () => {
  it("days + hours once uptime crosses a day", () => {
    expect(fmtUptime(3 * 86_400 + 5 * 3_600 + 42)).toBe("3d 5h");
    expect(fmtUptime(86_400)).toBe("1d 0h");
  });

  it("hours only under a day", () => {
    expect(fmtUptime(7 * 3_600 + 120)).toBe("7h");
  });

  it("sub-hour uptimes render as <1h (fresh reboot is visible, not blank)", () => {
    expect(fmtUptime(1800)).toBe("<1h");
    expect(fmtUptime(0)).toBe("<1h");
  });

  it("em-dash for missing, malformed or negative values", () => {
    expect(fmtUptime(null)).toBe("—");
    expect(fmtUptime(undefined)).toBe("—");
    expect(fmtUptime("3600")).toBe("—");
    expect(fmtUptime(-5)).toBe("—");
  });
});
