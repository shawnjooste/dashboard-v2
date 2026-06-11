import { createClient } from "@/lib/supabase/server";
import { suggestPerson, type SuggestPerson, type DeviceLinkRow } from "./device-link";

/** Devices + people for a client, each device with its current link + a suggestion. */
export async function getDeviceLinkRows(
  clientId: string,
): Promise<{ people: SuggestPerson[]; rows: DeviceLinkRow[] }> {
  const supabase = await createClient();
  const [devs, ppl] = await Promise.all([
    supabase.from("devices").select("id, hostname, last_user, assigned_user_label, person_id").eq("client_id", clientId).order("hostname"),
    supabase.from("people").select("id, email, display_name").eq("client_id", clientId).order("display_name"),
  ]);
  const people: SuggestPerson[] = (ppl.data ?? []).map((p) => ({
    id: p.id, email: p.email, name: p.display_name ?? p.email,
  }));
  const rows: DeviceLinkRow[] = (devs.data ?? []).map((d) => {
    const suggestion = d.person_id
      ? null
      : suggestPerson({ lastUser: d.last_user, label: d.assigned_user_label }, people);
    return {
      id: d.id,
      hostname: d.hostname,
      lastUser: d.last_user,
      personId: d.person_id,
      suggestedId: suggestion?.person.id ?? null,
    };
  });
  return { people, rows };
}
