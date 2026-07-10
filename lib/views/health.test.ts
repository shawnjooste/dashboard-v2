import { describe, it, expect } from "vitest";
import { deviceHealth, summarize, type DeviceInputs } from "./health";

const mk = (o: Partial<DeviceInputs> = {}): DeviceInputs => ({
  id: o.id ?? "d1",
  clientId: o.clientId ?? "c1",
  hostname: o.hostname ?? "PC1",
  user: o.user ?? "Alice",
  os: o.os ?? "Windows 11",
  avOk: o.avOk ?? true,
  patchStatus: o.patchStatus ?? "Fully Patched",
  patchesInstalled: o.patchesInstalled ?? 8,
  patchesPending: o.patchesPending ?? 0,
  usedPcts: o.usedPcts ?? [40],
  openAlerts: o.openAlerts ?? 0,
  disposition: o.disposition ?? "in_use",
});

describe("deviceHealth", () => {
  it("a clean device needs no attention", () => {
    const h = deviceHealth(mk());
    expect(h.needsAttention).toBe(false);
    expect(h.maxDiskPct).toBe(40);
    expect(h.patchPct).toBe(100);
  });
  it("flags AV off", () => {
    expect(deviceHealth(mk({ avOk: false })).flags.avOff).toBe(true);
    expect(deviceHealth(mk({ avOk: false })).needsAttention).toBe(true);
  });
  it("flags a disk at or above 90%", () => {
    expect(deviceHealth(mk({ usedPcts: [55, 92] })).flags.diskFull).toBe(true);
    expect(deviceHealth(mk({ usedPcts: [55, 92] })).maxDiskPct).toBe(92);
  });
  it("flags reboot-required / install-error patch status (API + CSV forms)", () => {
    expect(deviceHealth(mk({ patchStatus: "Reboot Required" })).flags.patchIssue).toBe(true);
    expect(deviceHealth(mk({ patchStatus: "RebootRequired" })).flags.patchIssue).toBe(true);
    expect(deviceHealth(mk({ patchStatus: "InstallError" })).flags.patchIssue).toBe(true);
    expect(deviceHealth(mk({ patchStatus: "FullyPatched" })).flags.patchIssue).toBe(false);
  });
  it("flags open alerts", () => {
    expect(deviceHealth(mk({ openAlerts: 2 })).flags.openAlerts).toBe(true);
  });
  it("computes patch % from installed/(installed+pending)", () => {
    expect(deviceHealth(mk({ patchesInstalled: 6, patchesPending: 2 })).patchPct).toBe(75);
    expect(deviceHealth(mk({ patchesInstalled: 0, patchesPending: 0 })).patchPct).toBe(100);
  });
});

describe("summarize", () => {
  it("rolls up counts and fleet patch %", () => {
    const s = summarize([
      deviceHealth(mk({ id: "a", patchesInstalled: 10, patchesPending: 0 })),
      deviceHealth(mk({ id: "b", avOk: false, patchesInstalled: 6, patchesPending: 2 })),
    ]);
    expect(s.total).toBe(2);
    expect(s.needsAttention).toBe(1);
    expect(s.fleetPatchPct).toBe(88); // (100 + 75) / 2 rounded
  });
  it("handles an empty fleet", () => {
    const s = summarize([]);
    expect(s.total).toBe(0);
    expect(s.needsAttention).toBe(0);
    expect(s.fleetPatchPct).toBe(null);
  });
});
