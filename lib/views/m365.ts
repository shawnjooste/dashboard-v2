import { createClient } from "@/lib/supabase/server";
import { friendlySku } from "@/lib/m365-skus";
import { mfaCoveragePct, strongMethodLabels } from "@/lib/m365-derive";

export type M365User = {
  name: string;
  upn: string;
  enabled: boolean;
  licensed: boolean;
  licenses: string[];
  mfaStrong: boolean;
  methods: string[];
};

export type M365License = { sku: string; total: number | null; consumed: number | null; maxed: boolean };

export type M365View = {
  connected: boolean;
  tenantName: string | null;
  securityDefaultsOn: boolean | null;
  caPolicyCount: number | null;
  secureScore: number | null;
  secureScoreMax: number | null;
  activeLicensed: number;
  mfaCoverage: number | null;
  passwordOnly: M365User[];
  unlicensedEnabled: M365User[];
  licenses: M365License[];
  trend: number[];
};

export type M365ClientSummary = {
  clientId: string;
  name: string;
  tenantName: string | null;
  securityDefaultsOn: boolean | null;
  licensedUsers: number;
  mfaCoverage: number | null;
  withoutMfa: number;
  lastPullAt: string | null;
};

export type M365Overview = {
  tenants: M365ClientSummary[];
  totals: {
    tenants: number;
    licensedUsers: number;
    mfaCoverage: number | null;
    withoutMfa: number;
    securityDefaultsOff: number;
  };
};

/** Cross-tenant M365 roll-up for the admin cockpit (staff RLS = all). */
export async function getM365Overview(): Promise<M365Overview> {
  const supabase = await createClient();
  const [tenantsRes, clientsRes, connsRes] = await Promise.all([
    supabase.from("m365_tenant").select("client_id, security_defaults_on, licensed_user_count, mfa_strong_count"),
    supabase.from("clients").select("id, name"),
    supabase.from("m365_connections").select("client_id, tenant_name, last_pull_at"),
  ]);
  const nameById = new Map((clientsRes.data ?? []).map((c) => [c.id, c.name]));
  const connById = new Map((connsRes.data ?? []).map((c) => [c.client_id, c]));

  const tenants: M365ClientSummary[] = (tenantsRes.data ?? [])
    .map((t) => {
      const licensed = t.licensed_user_count ?? 0;
      const strong = t.mfa_strong_count ?? 0;
      return {
        clientId: t.client_id,
        name: nameById.get(t.client_id) ?? "Unknown",
        tenantName: connById.get(t.client_id)?.tenant_name ?? null,
        securityDefaultsOn: t.security_defaults_on,
        licensedUsers: licensed,
        mfaCoverage: licensed ? Math.round((100 * strong) / licensed) : null,
        withoutMfa: Math.max(0, licensed - strong),
        lastPullAt: connById.get(t.client_id)?.last_pull_at ?? null,
      };
    })
    .sort((a, b) => b.withoutMfa - a.withoutMfa || a.name.localeCompare(b.name));

  const sumL = tenants.reduce((n, t) => n + t.licensedUsers, 0);
  const sumStrong = tenants.reduce((n, t) => n + (t.licensedUsers - t.withoutMfa), 0);
  return {
    tenants,
    totals: {
      tenants: tenants.length,
      licensedUsers: sumL,
      mfaCoverage: sumL ? Math.round((100 * sumStrong) / sumL) : null,
      withoutMfa: tenants.reduce((n, t) => n + t.withoutMfa, 0),
      securityDefaultsOff: tenants.filter((t) => t.securityDefaultsOn === false).length,
    },
  };
}

type M365UserRow = {
  display_name: string | null;
  user_principal_name: string | null;
  account_enabled: boolean | null;
  is_licensed: boolean;
  assigned_licenses: string[] | null;
  mfa_methods: string[] | null;
  mfa_strong: boolean;
};

function toM365User(u: M365UserRow): M365User {
  return {
    name: u.display_name ?? "(unnamed)",
    upn: u.user_principal_name ?? "",
    enabled: !!u.account_enabled,
    licensed: u.is_licensed,
    licenses: (u.assigned_licenses ?? []).map(friendlySku),
    mfaStrong: u.mfa_strong,
    methods: strongMethodLabels(u.mfa_methods ?? []),
  };
}

/** Enabled users for one client, with friendly licence names + MFA detail
 *  (the drill-down behind "active licensed users" and the licence table). */
export async function getM365Users(clientId: string): Promise<M365User[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("m365_users")
    .select("display_name, user_principal_name, account_enabled, is_licensed, assigned_licenses, mfa_methods, mfa_strong")
    .eq("client_id", clientId);
  return (data ?? [])
    .map(toM365User)
    .filter((u) => u.enabled)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Assembles the M365 view for one client (RLS-scoped). */
export async function getM365View(clientId: string): Promise<M365View> {
  const supabase = await createClient();
  const [tenant, usersRes, licensesRes, snapsRes] = await Promise.all([
    supabase.from("m365_tenant").select("*").eq("client_id", clientId).maybeSingle(),
    supabase.from("m365_users").select("display_name, user_principal_name, account_enabled, is_licensed, assigned_licenses, mfa_methods, mfa_strong").eq("client_id", clientId),
    supabase.from("m365_licenses").select("sku_part_number, total, consumed").eq("client_id", clientId).order("consumed", { ascending: false }),
    supabase.from("m365_snapshots").select("snapshot_date, mfa_coverage_pct").eq("client_id", clientId).order("snapshot_date"),
  ]);

  const rows = usersRes.data ?? [];
  if (rows.length === 0 && !tenant.data) {
    return {
      connected: false, tenantName: null, securityDefaultsOn: null, caPolicyCount: null,
      secureScore: null, secureScoreMax: null, activeLicensed: 0, mfaCoverage: null,
      passwordOnly: [], unlicensedEnabled: [], licenses: [], trend: [],
    };
  }

  const users: M365User[] = rows.map(toM365User);

  const active = users.filter((u) => u.enabled && u.licensed);
  return {
    connected: true,
    tenantName: null,
    securityDefaultsOn: tenant.data?.security_defaults_on ?? null,
    caPolicyCount: tenant.data?.ca_policy_count ?? null,
    secureScore: tenant.data?.secure_score ?? null,
    secureScoreMax: tenant.data?.secure_score_max ?? null,
    activeLicensed: active.length,
    mfaCoverage: mfaCoveragePct(active.map((u) => ({ isLicensed: true, mfaStrong: u.mfaStrong }))),
    passwordOnly: active.filter((u) => !u.mfaStrong).sort((a, b) => a.name.localeCompare(b.name)),
    unlicensedEnabled: users.filter((u) => u.enabled && !u.licensed).sort((a, b) => a.name.localeCompare(b.name)),
    licenses: (licensesRes.data ?? []).map((l) => ({
      sku: friendlySku(l.sku_part_number),
      total: l.total,
      consumed: l.consumed,
      maxed: l.total !== null && l.consumed !== null && l.consumed >= l.total,
    })),
    trend: (snapsRes.data ?? []).map((s) => Number(s.mfa_coverage_pct)).filter((n) => Number.isFinite(n)),
  };
}
