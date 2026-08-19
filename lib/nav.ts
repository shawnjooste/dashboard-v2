import type { UserRole } from "@/lib/types/domain";
import { FEATURE_HREFS } from "@/lib/feature-access";

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
        { label: "NED", href: "/admin/ned" },
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
        { label: "Agreements", href: "/admin/agreements" },
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
        { label: "Agreements", href: "/agreements" },
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

/** The four tabs on a phone. Home is the needs-you list, so it earns its slot;
 *  everything else lives behind More. Kept here rather than in the tab bar so
 *  "what mobile leads with" is one editable place. */
export const MOBILE_TABS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Tickets", href: "/support" },
  { label: "Status", href: "/status" },
  { label: "More", href: "/more" },
];

type NavOpts = {
  role: UserRole;
  allowedHrefs?: string[];
  billingEnabled?: boolean;
  pendingMode?: "pending" | "rejected";
};

/** The nav this user is actually entitled to. Single source of truth for the
 *  desktop sidebar and the mobile More page — if these two ever computed
 *  entitlement separately, a feature hidden on desktop could leak on mobile. */
export function visibleNavGroups({
  role,
  allowedHrefs,
  billingEnabled = false,
  pendingMode,
}: NavOpts): NavGroup[] {
  const gated = new Set(Object.values(FEATURE_HREFS));
  const allowed = new Set(allowedHrefs ?? [...gated]);
  if (!billingEnabled) allowed.delete("/billing"); // needs a Xero link too
  // No company: neither the role nav nor feature filtering means anything.
  const source = pendingMode ? (pendingMode === "pending" ? PENDING_NAV : []) : NAV[role];
  return source
    .map((g) => ({ ...g, items: g.items.filter((i) => !gated.has(i.href) || allowed.has(i.href)) }))
    .filter((g) => g.items.length > 0);
}

/** What the More page lists: everything they're entitled to that isn't already
 *  a tab. */
export function mobileMenuGroups(opts: NavOpts): NavGroup[] {
  const tabs = new Set(MOBILE_TABS.map((t) => t.href));
  return visibleNavGroups(opts)
    .map((g) => ({ ...g, items: g.items.filter((i) => !tabs.has(i.href)) }))
    .filter((g) => g.items.length > 0);
}
