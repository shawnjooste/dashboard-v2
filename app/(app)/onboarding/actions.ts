"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function claimDevice(formData: FormData) {
  const deviceId = String(formData.get("device_id") ?? "");
  if (!deviceId) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_device", { p_device_id: deviceId });
  if (error) throw new Error(error.message);
  redirect("/");
}
