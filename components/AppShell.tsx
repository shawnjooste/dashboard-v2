import { type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import logo from "@/public/rocking-logo.png";
import type { UserRole } from "@/lib/types/domain";
import { NAV, PENDING_NAV } from "@/lib/nav";
import { FEATURE_HREFS } from "@/lib/feature-access";
import { dotColour } from "@/lib/status-helpers";
import { IncidentBanner } from "./IncidentBanner";
import { Sidebar } from "./Sidebar";
import { MobileTabBar } from "./MobileTabBar";

function initials(name: string): string {
  const base = name.includes("@") ? name.split("@")[0] : name;
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  const letters = (parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)) || "?";
  return letters.toUpperCase();
}

export function AppShell({
  email,
  role,
  impersonating,
  accountName,
  billingEnabled = false,
  allowedHrefs,
  suspensionNote,
  statusType = null,
  incident = null,
  pendingMode,
  children,
}: {
  email: string;
  role: UserRole;
  impersonating?: string | null;
  accountName?: string | null;
  billingEnabled?: boolean;
  /** Set when the client's services are suspended — renders a standing
   *  banner. A notice only; nothing in the portal is gated. */
  suspensionNote?: string | null;
  /** Hrefs of the gateable sections this user may see (from feature access).
   *  Omitted (staff/admin shell) = no feature filtering. */
  allowedHrefs?: string[];
  /** Worst active incident type visible to this viewer; null = all clear.
   *  Drives the colour of the Status dot in the top bar. */
  statusType?: string | null;
  /** Set when an outage (or anything that opened chat) is running for this
   *  viewer — renders the red bar above everything. */
  incident?: { title: string; chatOpen: boolean } | null;
  /** Set for a user with no company: 'pending' gets a Status-only sidebar,
   *  'rejected' gets no navigation at all. Unset = the normal portal. */
  pendingMode?: "pending" | "rejected";
  children: ReactNode;
}) {
  const gated = new Set(Object.values(FEATURE_HREFS));
  const allowed = new Set(allowedHrefs ?? [...gated]);
  if (!billingEnabled) allowed.delete("/billing"); // needs a Xero link too
  // No company: skip role nav and feature filtering entirely — neither means
  // anything without one.
  const source = pendingMode ? (pendingMode === "pending" ? PENDING_NAV : []) : NAV[role];
  const groups = source
    .map((g) => ({ ...g, items: g.items.filter((i) => !gated.has(i.href) || allowed.has(i.href)) }))
    .filter((g) => g.items.length > 0);
  // Staff get the same status page with the post/resolve controls.
  const statusHref = role === "rocking_staff" ? "/admin/status" : "/status";
  const orgLabel = accountName ?? (role === "rocking_staff" ? "Rocking" : email.split("@")[1] ?? "");

  return (
    <div className="flex min-h-screen flex-col">
      {impersonating && (
        <div className="flex items-center justify-between gap-3 bg-warn-tint px-4 py-2 text-sm font-medium text-warn-ink print:hidden">
          <span>
            Viewing as <strong>{impersonating}</strong> — read-only
          </span>
          <form action="/impersonation/exit" method="post">
            <button className="rounded border border-warn-line px-3 py-0.5 hover:bg-warn-tint-2">
              Exit
            </button>
          </form>
        </div>
      )}

      {incident && (
        <IncidentBanner title={incident.title} chatOpen={incident.chatOpen} statusHref={statusHref} />
      )}

      {suspensionNote && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-warn-tint px-4 py-2.5 text-sm text-warn-ink print:hidden">
          <span>
            <strong>Some services are suspended.</strong> {suspensionNote}
          </span>
          <a
            href="/billing"
            className="shrink-0 rounded border border-warn-line px-3 py-0.5 font-medium hover:bg-warn-tint-2"
          >
            View billing
          </a>
        </div>
      )}

      <div className="flex min-h-0 flex-1 md:flex-row">
        {/* Sidebar: left column on md+, slim top bar on small screens */}
        <aside className="hidden flex-col gap-2 border-b border-line bg-card px-3 pb-4 md:flex md:w-[248px] md:shrink-0 md:gap-0 md:border-b-0 md:border-r print:hidden">
          <div className="flex items-center px-3 pb-3 pt-[18px]">
            <Image src={logo} alt="Rocking" priority className="h-5 w-auto" />
          </div>
          <div className="flex-1 overflow-x-auto md:overflow-visible">
            <Sidebar groups={groups} />
          </div>
          <div className="mt-2 hidden border-t border-line-soft pt-3 md:block">
            <div className="px-3 text-[13px] font-semibold text-ink">{orgLabel}</div>
            <div className="truncate px-3 pt-0.5 text-xs text-faint" title={email}>
              {email}
            </div>
            <form action="/auth/signout" method="post" className="px-3 pt-3">
              <button className="w-full rounded-md border border-line px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-line-soft">
                Sign out
              </button>
            </form>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 items-center gap-5 border-b border-line bg-card px-4 md:px-6 print:hidden">
            {/* Mobile: logo doubles as "home" — on a phone, tickets IS home. */}
            <Link href="/support" className="md:hidden">
              <Image src={logo} alt="Rocking" priority className="h-5 w-auto" />
            </Link>
            <div className="ml-auto flex items-center gap-4 md:gap-5">
              {pendingMode !== "rejected" && (
                <Link
                  href={statusHref}
                  className="flex items-center gap-1.5 text-[13.5px] font-medium text-ink-3 hover:text-ink"
                >
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: dotColour(statusType) }}
                  />
                  Status
                </Link>
              )}
              <form action="/auth/signout" method="post" className="md:hidden">
                <button className="rounded-md border border-line px-2.5 py-1 text-[13px] font-medium text-ink-2">
                  Sign out
                </button>
              </form>
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-ink text-[11.5px] font-semibold text-white">
                {initials(email)}
              </span>
            </div>
          </div>

          <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-28 pt-6 md:px-10 md:py-9 md:pb-9 print:max-w-none print:p-0">
            {children}
          </main>
        </div>
      </div>

      <MobileTabBar />
    </div>
  );
}
