import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "device-photos";

export type DevicePhoto = {
  id: string;
  caption: string | null;
  createdAt: string;
  author: string | null;
  url: string | null;
};

/**
 * Photos of a device visible to the current user, newest first. The select
 * runs under RLS (staff: all; clients: only their own devices' photos), and
 * we only sign URLs for rows RLS returned — so the signed URLs inherit the
 * same access control. URLs are valid for 1 hour (one server render).
 * Author resolution uses the caller's RLS view of profiles; client users
 * can't see staff profiles, so for them author is simply null.
 */
export async function getDevicePhotos(deviceId: string): Promise<DevicePhoto[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("device_photos")
    .select("id, caption, storage_path, uploaded_by_profile_id, created_at")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false });
  if (!data?.length) return [];

  const { data: profiles } = await supabase.from("profiles").select("id, email");
  const email = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const label = (id: string | null) => {
    const e = id ? email.get(id) : null;
    return e ? e.split("@")[0].replace(/[._]/g, " ") : null;
  };

  const { data: signed } = await createServiceClient()
    .storage.from(BUCKET)
    .createSignedUrls(data.map((p) => p.storage_path), 3600);
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return data.map((p) => ({
    id: p.id,
    caption: p.caption,
    createdAt: p.created_at,
    author: label(p.uploaded_by_profile_id),
    url: urlByPath.get(p.storage_path) ?? null,
  }));
}
