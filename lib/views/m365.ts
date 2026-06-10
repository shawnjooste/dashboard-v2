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

  const users: M365User[] = rows.map((u) => ({
    name: u.display_name ?? "(unnamed)",
    upn: u.user_principal_name ?? "",
    enabled: !!u.account_enabled,
    licensed: u.is_licensed,
    licenses: (u.assigned_licenses ?? []).map(friendlySku),
    mfaStrong: u.mfa_strong,
    methods: strongMethodLabels(u.mfa_methods ?? []),
  }));

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
