import type { UserRole } from "@/lib/types/domain";

export type NavItem = { label: string; href: string; external?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

/** Role → grouped sidebar. Live items only — add entries as features ship.
 *  An empty group label renders the items with no section heading. */
/** Sidebar for someone who isn't linked to a company yet. Everything else in
 *  the portal needs a client to mean anything; the status page doesn't. */
export const PENDING_NAV: NavGroup[] = [
  { label: "", items: [{ label: "Status", href: "/status" }] },
];

export const NAV: Record<UserRole, NavGroup[]> = {
  rocking_staff: [
    { label: "", items: [{ label: "Overview", href: "/admin" }] },
    {
      label: "Clients",
      items: [
        { label: "Clients", href: "/admin/clients" },
        { label: "Users", href: "/admin/users" },
        { label: "Activity", href: "/admin/activity" },
      ],
    },
    {
      label: "Services",
      items: [
        { label: "Security", href: "/admin/security" },
        { label: "Microsoft 365", href: "/admin/m365" },
        { label: "Devices", href: "/admin/devices" },
        { label: "UniFi", href: "https://unifi.rocking.co.za:8443/manage/nmvgyf9h/dashboard", external: true },
        { label: "Compliance docs", href: "/admin/compliance" },
      ],
    },
    {
      label: "Business",
      items: [
        { label: "RFQs", href: "/admin/rfqs" },
        { label: "Quotes", href: "/admin/quotes" },
        { label: "Jobs", href: "/admin/jobs" },
        { label: "Tickets", href: "/admin/tickets" },
        { label: "Bookings", href: "/admin/bookings" },
        { label: "Support packages", href: "/admin/support-packages" },
        { label: "Suppliers", href: "/admin/suppliers" },
        { label: "Products", href: "/admin/products" },
      ],
    },
    {
      label: "Account",
      items: [
        { label: "Approvals", href: "/admin/pending" },
      ],
    },
  ],
  client_manager: [
    { label: "", items: [{ label: "Account home", href: "/" }] },
    {
      label: "Your services",
      items: [
        { label: "Connectivity", href: "/connectivity" },
        { label: "Support", href: "/support" },
        { label: "Devices", href: "/devices" },
        { label: "Network", href: "/network" },
        { label: "Microsoft 365", href: "/m365" },
      ],
    },
    {
      label: "Account",
      items: [
        { label: "Billing", href: "/billing" },
        { label: "Services", href: "/services" },
        { label: "Quotes", href: "/quotes" },
        { label: "Team", href: "/team" },
        { label: "Communications", href: "/communications" },
      ],
    },
  ],
  client_member: [
    { label: "", items: [{ label: "My machine", href: "/" }] },
    {
      label: "Your services",
      items: [
        { label: "Support", href: "/support" },
        { label: "Communications", href: "/communications" },
      ],
    },
  ],
};

/** What a phone shows a signed-in client: tickets and service status, nothing
 *  else. Deliberately two items — the other sections stay desktop-only and are
 *  hidden from mobile navigation entirely (they still render by direct URL).
 *  Keep this list here rather than in the shell so "what mobile offers" is one
 *  editable place. */
export const MOBILE_NAV: NavItem[] = [
  { label: "Tickets", href: "/support" },
  { label: "Status", href: "/status" },
];
