"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { photoError, safePhotoName } from "@/lib/device-photo-helpers";

const BUCKET = "device-photos";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

function revalidateDevice(deviceId: string) {
  revalidatePath(`/admin/devices/${deviceId}`);
  revalidatePath(`/devices/${deviceId}`);
}

export type PhotoUploadResult = { ok: true } | { ok: false; error: string };

/** Staff-only. Uploads every valid image in the batch; invalid files are
 *  reported but don't block the others. Caption applies to the whole batch. */
export async function uploadDevicePhotos(
  deviceId: string,
  _prev: PhotoUploadResult | null,
  formData: FormData,
): Promise<PhotoUploadResult> {
  const me = await staff();
  const caption = String(formData.get("caption") ?? "").trim() || null;
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "Pick at least one image." };

  const service = createServiceClient();
  const supabase = await createClient();
  const errors: string[] = [];

  for (const file of files) {
    const invalid = photoError(file);
    if (invalid) {
      errors.push(invalid);
      continue;
    }
    const path = `${deviceId}/${crypto.randomUUID()}-${safePhotoName(file.name)}`;
    const { error: upErr } = await service.storage
      .from(BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (upErr) {
      errors.push(`${file.name}: ${upErr.message}`);
      continue;
    }
    const { error: insErr } = await supabase.from("device_photos").insert({
      device_id: deviceId,
      storage_path: path,
      caption,
      file_size: file.size,
      mime_type: file.type,
      uploaded_by_profile_id: me.id,
    });
    if (insErr) {
      await service.storage.from(BUCKET).remove([path]); // no orphan file
      errors.push(`${file.name}: ${insErr.message}`);
    }
  }

  revalidateDevice(deviceId);
  return errors.length ? { ok: false, error: errors.join(" ") } : { ok: true };
}

export async function deleteDevicePhoto(photoId: string, deviceId: string) {
  await staff();
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from("device_photos")
    .select("storage_path")
    .eq("id", photoId)
    .maybeSingle();
  if (photo?.storage_path) await createServiceClient().storage.from(BUCKET).remove([photo.storage_path]);
  await supabase.from("device_photos").delete().eq("id", photoId);
  revalidateDevice(deviceId);
}
