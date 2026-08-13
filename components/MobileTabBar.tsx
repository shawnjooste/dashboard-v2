"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_TABS } from "@/lib/nav";

/** Fixed four-tab bar — the primary navigation on a phone. Hidden at md+ where
 *  the sidebar takes over. Prefix match keeps Tickets lit inside a thread;
 *  Home is exact, or every route would light it. */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-card md:hidden print:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {MOBILE_TABS.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[12px] font-semibold transition-colors ${
              active ? "text-brand" : "text-ink-3"
            }`}
          >
            <span
              aria-hidden
              className={`h-[3px] w-8 rounded-full ${active ? "bg-brand" : "bg-transparent"}`}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
