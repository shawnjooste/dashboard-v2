"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Sets a device's portal-owned disposition. Authorisation lives in the
 *  set_device_disposition RPC: Rocking staff, or a manager of the device's
 *  client. Members and other clients' managers are rejected there. */
export async function setDeviceDisposition(deviceId: string, formData: FormData) {
  const disposition = String(formData.get("disposition") ?? "");
  const note = String(formData.get("note") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_device_disposition", {
    p_device_id: deviceId,
    p_disposition: disposition,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/devices/${deviceId}`);
  revalidatePath(`/devices/${deviceId}`);
}
