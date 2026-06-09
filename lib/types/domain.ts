import type { Database } from "./database";

export const USER_ROLES = [
  "rocking_staff",
  "client_manager",
  "client_member",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type ProfileStatus = "pending" | "active";
export type ClientStatus = "active" | "inactive";

// Row aliases sourced from the generated Database type — single source of truth.
export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Device = Database["public"]["Tables"]["devices"]["Row"];
export type DeviceStorage = Database["public"]["Tables"]["device_storage"]["Row"];
export type DevicePatchStatus =
  Database["public"]["Tables"]["device_patch_status"]["Row"];
export type DeviceAlert = Database["public"]["Tables"]["device_alerts"]["Row"];
export type DeviceHealthSnapshot =
  Database["public"]["Tables"]["device_health_snapshots"]["Row"];
export type ImportRun = Database["public"]["Tables"]["import_runs"]["Row"];

export function isClientScoped(role: UserRole): boolean {
  return role === "client_member" || role === "client_manager";
}

/** Datto AV status string -> tri-state boolean (null when unknown/empty). */
export function normalizeAvStatus(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("not running")) return false;
  if (v.includes("running")) return true;
  return null;
}
