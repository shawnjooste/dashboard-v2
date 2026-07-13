"use client";

import { useMemo, useState } from "react";
import type { Product } from "@/lib/views/products";
import { updateProduct, toggleProductActive } from "@/lib/actions/products";

const COLS = "grid-cols-[1.3fr_1.7fr_90px_140px]";
const FIELD = "w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

export function ProductsTable({ products }: { products: Product[] }) {
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return products;
    return products.filter((p) => `${p.name} ${p.description ?? ""}`.toLowerCase().includes(n));
  }, [products, q]);

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or description…"
        className="w-full rounded-xl border border-line bg-card px-4 py-2.5 text-[15px] text-ink outline-none focus:border-faint"
      />
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <div className={`grid ${COLS} gap-3 border-b border-line-soft bg-[#FCFCFD] px-5 py-[11px] text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint`}>
          <div>Name</div>
          <div>Description</div>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>
        {filtered.map((p) =>
          editingId === p.id ? (
            <form
              key={p.id}
              action={async (fd) => {
                await updateProduct(fd);
                setEditingId(null);
              }}
              className={`grid ${COLS} items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0`}
            >
              <input type="hidden" name="id" value={p.id} />
              <input name="name" defaultValue={p.name} required className={FIELD} />
              <input name="description" defaultValue={p.description ?? ""} className={FIELD} />
              <div />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingId(null)} className="text-[13px] font-medium text-faint hover:text-ink-2">
                  Cancel
                </button>
                <button type="submit" className="text-[13px] font-semibold text-ink hover:text-black">
                  Save
                </button>
              </div>
            </form>
          ) : (
            <div key={p.id} className={`grid ${COLS} items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0`}>
              <div className="truncate text-[13px] font-semibold text-ink">{p.name}</div>
              <div className="truncate text-[13px] text-ink-3">{p.description ?? "—"}</div>
              <div>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    p.isActive ? "bg-[#E9F7EF] text-good" : "bg-line-soft text-faint"
                  }`}
                >
                  {p.isActive ? "Active" : "Archived"}
                </span>
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setEditingId(p.id)} className="text-[13px] font-medium text-ink-2 hover:text-ink">
                  Edit
                </button>
                <form action={toggleProductActive.bind(null, p.id, !p.isActive)}>
                  <button type="submit" className="text-[13px] font-medium text-faint hover:text-brand">
                    {p.isActive ? "Archive" : "Restore"}
                  </button>
                </form>
              </div>
            </div>
          ),
        )}
        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center text-[13.5px] text-faint">
            {q ? "No products match your search." : "No products yet — add your first one."}
          </div>
        )}
      </div>
    </div>
  );
}
