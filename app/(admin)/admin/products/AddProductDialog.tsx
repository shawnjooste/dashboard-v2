"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createProduct } from "@/lib/actions/products";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

export function AddProductDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-[10px] bg-ink px-3.5 py-[9px] text-sm font-semibold text-white transition-colors hover:bg-black"
      >
        + Add product
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-ink">Add product</h2>
            <form
              action={async (fd) => {
                await createProduct(fd);
                setOpen(false);
              }}
              className="mt-4 space-y-3.5"
            >
              <label className="block">
                <span className={LABEL}>Name</span>
                <input name="name" required autoFocus placeholder="e.g. Microsoft 365 Business Premium" className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>Description</span>
                <textarea name="description" rows={2} placeholder="Optional — shown to the client alongside the name" className={FIELD} />
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft"
                >
                  Cancel
                </button>
                <SubmitButton />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
    >
      {pending ? "Adding…" : "Add product"}
    </button>
  );
}
