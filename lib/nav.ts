import type { UserRole } from "@/lib/types/domain";

export type NavItem = { label: string; href: string; external?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

/** Role → grouped sidebar. Live items only — add entries as features ship.
 *  An empty group label renders the items with no section heading. */
export const NAV: Record<UserRole, NavGroup[]> = {
  rocking_staff: [
    { label: "", items: [{ label: "Overview", href: "/admin" }] },
    {
      label: "Clients",
      items: [
        { label: "Clients", href: "/admin/clients" },
        { label: "Users", href: "/admin/users" },
      ],
    },
    { label: "Services", items: [{ label: "Microsoft 365", href: "/admin/m365" }] },
    {
      label: "Account",
      items: [
        { label: "Approvals", href: "/admin/pending" },
        { label: "Support", href: "https://help.rocking.co.za", external: true },
      ],
    },
  ],
  client_manager: [
    { label: "", items: [{ label: "Devices", href: "/" }] },
    { label: "Your services", items: [{ label: "Microsoft 365", href: "/m365" }] },
    {
      label: "Account",
      items: [
        { label: "Team", href: "/team" },
        { label: "Support", href: "/support" },
      ],
    },
  ],
  client_member: [
    { label: "", items: [{ label: "My machine", href: "/" }] },
    { label: "Account", items: [{ label: "Support", href: "/support" }] },
  ],
};
