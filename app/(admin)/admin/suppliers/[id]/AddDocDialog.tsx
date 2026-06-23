"use client";

import { useState } from "react";
import { UploadDocForm } from "./UploadDocForm";

export function AddDocDialog({ supplierId }: { supplierId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-[10px] bg-ink px-3.5 py-[9px] text-sm font-semibold text-white transition-colors hover:bg-black"
      >
        + Add document
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[6vh]" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-line bg-card p-6 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-ink">Add document</h2>
            <p className="mt-1 text-[13px] text-muted">A supplier quote, price list or spec — the file is optional.</p>
            <div className="mt-4">
              <UploadDocForm supplierId={supplierId} onSuccess={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
