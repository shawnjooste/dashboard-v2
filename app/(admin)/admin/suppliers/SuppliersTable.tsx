"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { SupplierRow } from "@/lib/views/suppliers";

const COLS = "grid-cols-[1.5fr_1fr_1.3fr_70px_110px]";

export function SuppliersTable({ rows }: { rows: SupplierRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) =>
      `${r.name} ${r.category ?? ""} ${r.contactName ?? ""} ${r.email ?? ""}`.toLowerCase().includes(n),
    );
  }, [rows, q]);

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, category or contact…"
        className="w-full rounded-xl border border-line bg-card px-4 py-2.5 text-[15px] text-ink outline-none focus:border-faint"
      />
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <div className={`grid ${COLS} gap-3 border-b border-line-soft bg-[#FCFCFD] px-5 py-[11px] text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint`}>
          <div>Name</div>
          <div>Category</div>
          <div>Contact</div>
          <div className="text-right">Docs</div>
          <div>Latest</div>
        </div>
        {filtered.map((r) => (
          <Link
            key={r.id}
            href={`/admin/suppliers/${r.id}`}
            className={`grid ${COLS} items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0 hover:bg-[#FAFAFA]`}
          >
            <div className="truncate text-[13px] font-semibold text-ink">{r.name}</div>
            <div className="truncate text-[13px] text-ink-3">{r.category ?? "—"}</div>
            <div className="truncate text-[13px] text-ink-2">{r.contactName ?? r.email ?? "—"}</div>
            <div className="text-right text-[13px] text-ink-2">{r.docCount}</div>
            <div className="text-[13px] text-faint">{r.latestDocDate ?? "—"}</div>
          </Link>
        ))}
        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center text-[13.5px] text-faint">
            {q ? "No suppliers match your search." : "No suppliers yet — add your first one."}
          </div>
        )}
      </div>
    </div>
  );
}
