"use client";

import { useRouter, usePathname } from "next/navigation";

export function ClientFilter({
  clients,
  selected,
}: {
  clients: { id: string; name: string }[];
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      value={selected}
      onChange={(e) =>
        router.push(e.target.value ? `${pathname}?client=${e.target.value}` : pathname)
      }
      className="rounded-lg border border-line bg-card px-3 py-2 text-[13.5px] font-medium text-ink-2 outline-none"
    >
      <option value="">All clients</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
