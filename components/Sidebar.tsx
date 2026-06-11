"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup } from "@/lib/nav";

/**
 * Active rules: exact match for "/" and "/admin" (so Overview doesn't stay lit
 * on /admin/clients), prefix match for everything else (so /admin/clients/[id]
 * keeps "Clients" active).
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/" || href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-2 md:flex-col md:gap-0">
      {groups.map((group, gi) => (
        <div key={group.label || gi}>
          {group.label && (
            <div className="hidden px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-faint md:block">
              {group.label}
            </div>
          )}
          <div className="flex gap-1 md:flex-col md:gap-px">
            {group.items.map((item) => {
              const external = item.external || item.href.startsWith("http");
              const active = !external && isActive(pathname, item.href);
              const cls = `flex items-center gap-2 rounded-md px-3 py-2 text-[13.5px] transition-colors select-none ${
                active
                  ? "bg-line-soft font-semibold text-ink shadow-[inset_3px_0_0_var(--color-brand)]"
                  : "font-medium text-ink-2 hover:bg-line-soft"
              }`;
              return external ? (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className={cls}
                >
                  <span>{item.label}</span>
                  <span className="ml-auto text-xs text-faint">↗</span>
                </a>
              ) : (
                <Link key={item.href} href={item.href} className={cls}>
                  <span>{item.label}</span>
                  {item.href !== "/" && item.href !== "/admin" && (
                    <span className="ml-auto text-[13px] text-line">›</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
