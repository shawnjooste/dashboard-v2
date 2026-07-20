/** Pure per-user feature-access logic — no server imports (vitest-safe).
 *  Role gives the defaults; profiles.feature_overrides subtracts (v1 is
 *  subtractive only). Mirrored in SQL by public.has_feature() — keep in sync. */

export const FEATURES = ["connectivity", "billing", "quotes", "team", "devices", "m365", "network"] as const;

export const FEATURE_LABELS: Record<string, string> = {
  connectivity: "Connectivity",
  billing: "Billing",
  quotes: "Quotes",
  team: "Team",
  devices: "Devices",
  m365: "Microsoft 365",
  network: "Network",
};

/** Nav href each feature gates (Home and Support are never gated). */
export const FEATURE_HREFS: Record<string, string> = {
  connectivity: "/connectivity",
  billing: "/billing",
  quotes: "/quotes",
  team: "/team",
  devices: "/devices",
  m365: "/m365",
  network: "/network",
};

export type Overrides = Record<string, boolean> | null;

/** Narrow a stored jsonb value (unknown shape) to Overrides. */
export function toOverrides(v: unknown): Overrides {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, boolean>) : null;
}

const MANAGER_DEFAULTS = new Set<string>(FEATURES);
const MEMBER_DEFAULTS = new Set<string>();

/** Role defaults minus per-user false overrides. Staff bypasses everything. */
export function canAccess(role: string, overrides: Overrides, feature: string): boolean {
  if (role === "rocking_staff") return true;
  const defaults = role === "client_manager" ? MANAGER_DEFAULTS : MEMBER_DEFAULTS;
  if (!defaults.has(feature)) return false;
  return overrides?.[feature] !== false;
}

export function allowedFeatures(role: string, overrides: Overrides): Set<string> {
  return new Set<string>(FEATURES.filter((f) => canAccess(role, overrides, f)));
}

/** Admin save: keep only defaults the admin unticked; nothing unticked → null. */
export function overridesFromSelection(role: string, selected: Set<string>): Record<string, false> | null {
  const defaults = role === "client_manager" ? MANAGER_DEFAULTS : MEMBER_DEFAULTS;
  const out: Record<string, false> = {};
  for (const f of defaults) if (!selected.has(f)) out[f] = false;
  return Object.keys(out).length ? out : null;
}
