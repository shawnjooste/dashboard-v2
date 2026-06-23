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
    {
      label: "Services",
      items: [
        { label: "Microsoft 365", href: "/admin/m365" },
        { label: "Devices", href: "/admin/devices" },
      ],
    },
    {
      label: "Business",
      items: [
        { label: "RFQs", href: "/admin/rfqs" },
        { label: "Quotes", href: "/admin/quotes" },
        { label: "Jobs", href: "/admin/jobs" },
        { label: "Suppliers", href: "/admin/suppliers" },
      ],
    },
    {
      label: "Account",
      items: [
        { label: "Approvals", href: "/admin/pending" },
        { label: "Support", href: "https://help.rocking.co.za", external: true },
      ],
    },
  ],
  client_manager: [
    { label: "", items: [{ label: "Account home", href: "/" }] },
    {
      label: "Your services",
      items: [
        { label: "Support", href: "/support" },
        { label: "Devices", href: "/devices" },
        { label: "Network", href: "/network" },
        { label: "Microsoft 365", href: "/m365" },
      ],
    },
    {
      label: "Account",
      items: [
        { label: "Quotes", href: "/quotes" },
        { label: "Team", href: "/team" },
      ],
    },
  ],
  client_member: [
    { label: "", items: [{ label: "My machine", href: "/" }] },
    { label: "Your services", items: [{ label: "Support", href: "/support" }] },
  ],
};
