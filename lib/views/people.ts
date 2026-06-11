import { createClient } from "@/lib/supabase/server";
import { friendlySku } from "@/lib/m365-skus";
import { strongMethodLabels } from "@/lib/m365-derive";

export type PersonRow = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  hasM365: boolean;
  licensed: boolean;
  mfaStrong: boolean | null;
  portalRole: string | null; // null = no portal login
};

/** People directory for a client with quick per-product flags. */
export async function getClientPeople(clientId: string): Promise<PersonRow[]> {
  const supabase = await createClient();
  const [people, m365, profiles] = await Promise.all([
    supabase.from("people").select("id, email, display_name, is_active").eq("client_id", clientId),
    supabase.from("m365_users").select("person_id, is_licensed, mfa_strong, account_enabled").eq("client_id", clientId),
    supabase.from("profiles").select("person_id, role").eq("client_id", clientId),
  ]);
  const m365By = new Map((m365.data ?? []).filter((m) => m.person_id).map((m) => [m.person_id, m]));
  const roleBy = new Map((profiles.data ?? []).filter((p) => p.person_id).map((p) => [p.person_id, p.role]));

  return (people.data ?? [])
    .map((p) => {
      const m = m365By.get(p.id);
      return {
        id: p.id,
        name: p.display_name ?? p.email,
        email: p.email,
        isActive: p.is_active,
        hasM365: !!m,
        licensed: !!m?.is_licensed,
        mfaStrong: m ? m.mfa_strong : null,
        portalRole: roleBy.get(p.id) ?? null,
      };
    })
    .sort((a, b) => Number(b.licensed) - Number(a.licensed) || a.name.localeCompare(b.name));
}

export type Person360 = {
  id: string;
  name: string;
  email: string;
  clientId: string;
  m365: {
    licensed: boolean;
    accountEnabled: boolean | null;
    mfaStrong: boolean;
    methods: string[];
    licenses: string[];
  } | null;
  portal: { role: string; status: string } | null;
};

/** Full Person 360 (RLS-scoped). Devices arrive in Slice 2. */
export async function getPerson360(personId: string): Promise<Person360 | null> {
  const supabase = await createClient();
  const { data: person } = await supabase
    .from("people").select("id, client_id, email, display_name").eq("id", personId).maybeSingle();
  if (!person) return null;

  const [m365, profile] = await Promise.all([
    supabase.from("m365_users")
      .select("is_licensed, account_enabled, mfa_strong, mfa_methods, assigned_licenses")
      .eq("person_id", personId).maybeSingle(),
    supabase.from("profiles").select("role, status").eq("person_id", personId).maybeSingle(),
  ]);

  return {
    id: person.id,
    name: person.display_name ?? person.email,
    email: person.email,
    clientId: person.client_id,
    m365: m365.data
      ? {
          licensed: m365.data.is_licensed,
          accountEnabled: m365.data.account_enabled,
          mfaStrong: m365.data.mfa_strong,
          methods: strongMethodLabels(m365.data.mfa_methods ?? []),
          licenses: (m365.data.assigned_licenses ?? []).map(friendlySku),
        }
      : null,
    portal: profile.data ? { role: profile.data.role, status: profile.data.status } : null,
  };
}
