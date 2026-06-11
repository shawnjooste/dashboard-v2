import { type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import logo from "@/public/rocking-logo.png";
import type { UserRole } from "@/lib/types/domain";
import { NAV } from "@/lib/nav";
import { Sidebar } from "./Sidebar";

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
  children,
}: {
  email: string;
  role: UserRole;
  impersonating?: string | null;
  accountName?: string | null;
  children: ReactNode;
}) {
  const groups = NAV[role];
  const supportHref = role === "rocking_staff" ? "https://help.rocking.co.za" : "/support";
  const orgLabel = accountName ?? (role === "rocking_staff" ? "Rocking" : email.split("@")[1] ?? "");

  return (
    <div className="flex min-h-screen flex-col">
      {impersonating && (
        <div className="flex items-center justify-between gap-3 bg-warn-tint px-4 py-2 text-sm font-medium text-warn-ink">
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

      <div className="flex min-h-0 flex-1 md:flex-row">
        {/* Sidebar: left column on md+, slim top bar on small screens */}
        <aside className="flex flex-col gap-2 border-b border-line bg-card px-3 pb-4 md:w-[248px] md:shrink-0 md:gap-0 md:border-b-0 md:border-r">
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
          {/* mobile sign-out */}
          <form action="/auth/signout" method="post" className="md:hidden">
            <button className="rounded-md border border-line px-3 py-1 text-sm text-ink-2 hover:bg-line-soft">
              Sign out
            </button>
          </form>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 items-center gap-5 border-b border-line bg-card px-6">
            <div className="ml-auto flex items-center gap-5">
              <Link
                href={supportHref}
                {...(role === "rocking_staff" ? { target: "_blank", rel: "noreferrer" } : {})}
                className="text-[13.5px] font-medium text-ink-3 hover:text-ink"
              >
                Support
              </Link>
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-ink text-[11.5px] font-semibold text-white">
                {initials(email)}
              </span>
            </div>
          </div>

          <main className="mx-auto w-full max-w-[1240px] flex-1 px-6 py-9 md:px-10">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
