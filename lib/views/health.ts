export type DeviceInputs = {
  id: string;
  clientId: string;
  hostname: string;
  user: string | null;
  os: string | null;
  avOk: boolean | null;
  patchStatus: string | null;
  patchesInstalled: number | null;
  patchesPending: number | null;
  usedPcts: number[];
  openAlerts: number;
};

export type DeviceHealth = DeviceInputs & {
  maxDiskPct: number | null;
  patchPct: number | null;
  flags: { avOff: boolean; diskFull: boolean; patchIssue: boolean; openAlerts: boolean };
  needsAttention: boolean;
};

// Datto RMM API forms (no spaces) + the legacy CSV-export forms.
const PATCH_ISSUE = new Set([
  "RebootRequired", "InstallError",
  "Reboot Required", "Install Error",
]);

export function deviceHealth(d: DeviceInputs): DeviceHealth {
  const maxDiskPct = d.usedPcts.length ? Math.max(...d.usedPcts) : null;
  const installed = d.patchesInstalled ?? 0;
  const pending = d.patchesPending ?? 0;
  const denom = installed + pending;
  const patchPct = denom > 0 ? Math.round((100 * installed) / denom) : 100;

  const flags = {
    avOff: d.avOk === false,
    diskFull: maxDiskPct !== null && maxDiskPct >= 90,
    patchIssue: d.patchStatus !== null && PATCH_ISSUE.has(d.patchStatus),
    openAlerts: d.openAlerts > 0,
  };
  const needsAttention = flags.avOff || flags.diskFull || flags.patchIssue || flags.openAlerts;
  return { ...d, maxDiskPct, patchPct, flags, needsAttention };
}

export type FleetSummary = {
  total: number;
  needsAttention: number;
  avOff: number;
  diskFull: number;
  patchIssue: number;
  openAlerts: number;
  fleetPatchPct: number | null;
};

export function summarize(devices: DeviceHealth[]): FleetSummary {
  const total = devices.length;
  const pcts = devices.map((d) => d.patchPct).filter((p): p is number => p !== null);
  const fleetPatchPct = pcts.length
    ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
    : null;
  return {
    total,
    needsAttention: devices.filter((d) => d.needsAttention).length,
    avOff: devices.filter((d) => d.flags.avOff).length,
    diskFull: devices.filter((d) => d.flags.diskFull).length,
    patchIssue: devices.filter((d) => d.flags.patchIssue).length,
    openAlerts: devices.filter((d) => d.flags.openAlerts).length,
    fleetPatchPct,
  };
}
