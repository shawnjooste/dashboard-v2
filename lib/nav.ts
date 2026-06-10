import type { UserRole } from "@/lib/types/domain";

export type NavItem = { label: string; href: string };

/** Role → sidebar items. Live items only — add entries here as features ship. */
export const NAV: Record<UserRole, NavItem[]> = {
  rocking_staff: [
    { label: "Overview", href: "/admin" },
    { label: "Clients", href: "/admin/clients" },
    { label: "Approvals", href: "/admin/pending" },
  ],
  client_manager: [
    { label: "Devices", href: "/" },
    { label: "Team", href: "/team" },
  ],
  client_member: [{ label: "My Machine", href: "/" }],
};
