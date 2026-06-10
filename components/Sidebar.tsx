"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/nav";

/**
 * Active rules: exact match for "/" and "/admin" (so Overview doesn't stay lit
 * on /admin/clients), prefix match for everything else (so /admin/clients/[id]
 * keeps "Clients" active).
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/" || href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 md:flex-col">
      {items.map((item) => {
        const external = item.href.startsWith("http");
        const active = !external && isActive(pathname, item.href);
        const cls = `rounded-md px-3 py-2 text-sm font-medium ${
          active
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        }`;
        return external ? (
          <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className={cls}>
            {item.label} ↗
          </a>
        ) : (
          <Link key={item.href} href={item.href} className={cls}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
