"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";

const KINDS = ["fibre", "wireless", "lte", "other"];

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
  return {
    label: str(fd, "label"),
    kind: KINDS.includes(kind) ? kind : "other",
    provider: str(fd, "provider"),
    download_mbps: num(fd, "download_mbps"),
    upload_mbps: num(fd, "upload_mbps"),
    librenms_device_id: num(fd, "librenms_device_id"),
    notes: str(fd, "notes"),
  };
}

export async function addLine(clientId: string, formData: FormData) {
  await staff();
  const { label, ...fields } = lineFields(formData);
  if (!label) throw new Error("a line needs a label");
  const supabase = await createClient();
  const { error } = await supabase.from("connectivity_services").insert({ client_id: clientId, label, ...fields });
  if (error) throw new Error(error.message);
  revalidate(clientId);
}

export async function updateLine(lineId: string, clientId: string, formData: FormData) {
  await staff();
  const { label, ...fields } = lineFields(formData);
  if (!label) throw new Error("a line needs a label");
  const supabase = await createClient();
  const { error } = await supabase
    .from("connectivity_services")
    .update({ label, ...fields, updated_at: new Date().toISOString() })
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
