import type { UserRole } from "@/lib/types/domain";

export type NavItem = { label: string; href: string };

/** Role → sidebar items. Live items only — add entries here as features ship. */
export const NAV: Record<UserRole, NavItem[]> = {
  rocking_staff: [
    { label: "Overview", href: "/admin" },
    { label: "Clients", href: "/admin/clients" },
    { label: "Approvals", href: "/admin/pending" },
    { label: "Support", href: "https://help.rocking.co.za" },
  ],
  client_manager: [
    { label: "Devices", href: "/" },
    { label: "Team", href: "/team" },
    { label: "Support", href: "/support" },
  ],
  client_member: [
    { label: "My Machine", href: "/" },
    { label: "Support", href: "/support" },
  ],
};
