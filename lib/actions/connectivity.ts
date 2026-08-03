"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { connectivityKey, decryptSecret, encryptSecret, type Sealed } from "@/lib/secrets";
import { HOP_KINDS } from "@/lib/connectivity-helpers";

const KINDS = ["fibre", "wireless", "lte", "other"];
const CONN_TYPES = ["pppoe", "static", "dhcp"];

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};
const num = (fd: FormData, k: string) => {
  const v = Number(fd.get(k));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
};

function revalidate(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/connectivity");
}

function lineFields(fd: FormData) {
  const kind = String(fd.get("kind") ?? "fibre");
  const connType = String(fd.get("conn_type") ?? "dhcp");
  return {
    label: str(fd, "label"),
    kind: KINDS.includes(kind) ? kind : "other",
    provider: str(fd, "provider"),
    download_mbps: num(fd, "download_mbps"),
    upload_mbps: num(fd, "upload_mbps"),
    librenms_device_id: num(fd, "librenms_device_id"),
    notes: str(fd, "notes"),
    description: str(fd, "description"),
    conn_type: CONN_TYPES.includes(connType) ? connType : "dhcp",
    pppoe_username: str(fd, "pppoe_username"),
    ip_address: str(fd, "ip_address"),
    subnet_mask: str(fd, "subnet_mask"),
    gateway: str(fd, "gateway"),
    dns_servers: str(fd, "dns_servers"),
    vlan: num(fd, "vlan"),
  };
}

/** Seal a submitted password, or null when the field was left blank. */
function sealedFrom(fd: FormData): Sealed | null {
  const pw = str(fd, "pppoe_password");
  return pw ? encryptSecret(pw, connectivityKey()) : null;
}

export async function addLine(clientId: string, formData: FormData) {
  await staff();
  const { label, ...fields } = lineFields(formData);
  if (!label) throw new Error("a line needs a label");
  const sealed = sealedFrom(formData);
  const supabase = await createClient();
  const { error } = await supabase
    .from("connectivity_services")
    .insert({ client_id: clientId, label, ...fields, ...(sealed ? { pppoe_secret: sealed } : {}) });
  if (error) throw new Error(error.message);
  revalidate(clientId);
}

export async function updateLine(lineId: string, clientId: string, formData: FormData) {
  await staff();
  const { label, ...fields } = lineFields(formData);
  if (!label) throw new Error("a line needs a label");
  // A blank password field leaves the stored secret untouched.
  const sealed = sealedFrom(formData);
  const supabase = await createClient();
  const { error } = await supabase
    .from("connectivity_services")
    .update({
      label,
      ...fields,
      ...(sealed ? { pppoe_secret: sealed } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", lineId);
  if (error) throw new Error(error.message);
  revalidate(clientId);
}

export async function setLineActive(lineId: string, clientId: string, active: boolean) {
  await staff();
  const supabase = await createClient();
  await supabase
    .from("connectivity_services")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", lineId);
  revalidate(clientId);
}

export async function deleteLine(lineId: string, clientId: string) {
  await staff();
  const supabase = await createClient();
  await supabase.from("connectivity_services").delete().eq("id", lineId);
  revalidate(clientId);
}

/** Decrypt a line's PPPoE password for this request only. Allowed for staff,
 *  or a manager of that client who still has the connectivity feature. */
export async function revealPppoeSecret(
  serviceId: string,
): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  const me = await getCurrentProfile();
  if (!me.authenticated) return { ok: false, error: "Not signed in." };

  const service = createServiceClient();
  const { data: row } = await service
    .from("connectivity_services")
    .select("client_id, pppoe_secret, is_active")
    .eq("id", serviceId)
    .maybeSingle();
  if (!row?.pppoe_secret) return { ok: false, error: "No password stored for this line." };

  const isStaff = me.profile.role === "rocking_staff";
  const isTheirManager =
    me.profile.role === "client_manager" &&
    me.profile.client_id === row.client_id &&
    row.is_active &&
    canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "connectivity");
  if (!isStaff && !isTheirManager) return { ok: false, error: "Not allowed." };

  try {
    return { ok: true, secret: decryptSecret(row.pppoe_secret as unknown as Sealed, connectivityKey()) };
  } catch {
    return { ok: false, error: "Could not decrypt — check CONNECTIVITY_ENC_KEY." };
  }
}


/** Staff-only: add a hop to a line's path. Position defaults to the end. */
export async function addHop(serviceId: string, clientId: string, formData: FormData) {
  await staff();
  const label = str(formData, "hop_label");
  if (!label) throw new Error("a hop needs a label");
  const kind = String(formData.get("hop_kind") ?? "other");
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("connectivity_path_hops")
    .select("position")
    .eq("service_id", serviceId)
    .order("position", { ascending: false })
    .limit(1);
  const { error } = await supabase.from("connectivity_path_hops").insert({
    service_id: serviceId,
    label,
    kind: HOP_KINDS.includes(kind as (typeof HOP_KINDS)[number]) ? kind : "other",
    librenms_device_id: num(formData, "hop_librenms_device_id"),
    detail: str(formData, "hop_detail"),
    parallel_with_previous: formData.get("hop_parallel") === "on",
    position: (last?.[0]?.position ?? -1) + 1,
  });
  if (error) throw new Error(error.message);
  revalidate(clientId);
}

/** Toggle whether a hop is a redundant leg of the step before it, or the next
 *  step along. Editable after the fact — path shapes get corrected. */
export async function setHopParallel(hopId: string, clientId: string, parallel: boolean) {
  await staff();
  const supabase = await createClient();
  await supabase.from("connectivity_path_hops").update({ parallel_with_previous: parallel }).eq("id", hopId);
  revalidate(clientId);
}

export async function deleteHop(hopId: string, clientId: string) {
  await staff();
  const supabase = await createClient();
  await supabase.from("connectivity_path_hops").delete().eq("id", hopId);
  revalidate(clientId);
}

/** Nudge a hop one place along the path. */
export async function moveHop(hopId: string, clientId: string, direction: "up" | "down") {
  await staff();
  const supabase = await createClient();
  const { data: hop } = await supabase
    .from("connectivity_path_hops")
    .select("id, service_id, position")
    .eq("id", hopId)
    .maybeSingle();
  if (!hop) return;
  const { data: neighbours } = await supabase
    .from("connectivity_path_hops")
    .select("id, position")
    .eq("service_id", hop.service_id)
    .order("position");
  const list = neighbours ?? [];
  const i = list.findIndex((h) => h.id === hopId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= list.length) return;
  // Swap positions with the neighbour.
  await supabase.from("connectivity_path_hops").update({ position: list[j].position }).eq("id", list[i].id);
  await supabase.from("connectivity_path_hops").update({ position: list[i].position }).eq("id", list[j].id);
  revalidate(clientId);
}
