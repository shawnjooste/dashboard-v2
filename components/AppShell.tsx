import { type ReactNode } from "react";
import Image from "next/image";
import logo from "@/public/rocking-logo.png";
import type { UserRole } from "@/lib/types/domain";
import { NAV } from "@/lib/nav";
import { Sidebar } from "./Sidebar";

export function AppShell({
  email,
  role,
  children,
}: {
  email: string;
  role: UserRole;
  children: ReactNode;
}) {
  const items = NAV[role];
  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar: left column on md+, slim top bar on small screens */}
      <aside className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-3 md:min-h-screen md:w-56 md:shrink-0 md:flex-col md:items-stretch md:gap-0 md:border-b-0 md:border-r md:px-4 md:py-6">
        <Image src={logo} alt="Rocking" priority className="h-6 w-auto self-center md:mb-8 md:h-7 md:self-start" />
        <div className="flex-1 overflow-x-auto md:overflow-visible">
          <Sidebar items={items} />
        </div>
        <div className="flex items-center gap-3 md:mt-8 md:flex-col md:items-stretch md:gap-2 md:border-t md:border-gray-200 md:pt-4">
          <span className="hidden truncate text-xs text-gray-500 md:block" title={email}>
            {email}
          </span>
          <form action="/auth/signout" method="post">
            <button className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 md:w-full">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
