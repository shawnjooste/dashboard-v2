"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createSupplier } from "./actions";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

export function AddSupplierDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-[10px] bg-ink px-3.5 py-[9px] text-sm font-semibold text-white transition-colors hover:bg-black"
      >
        + Add supplier
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-ink">Add supplier</h2>
            <form action={createSupplier} className="mt-4 space-y-3.5">
              <label className="block">
                <span className={LABEL}>Name</span>
                <input name="name" required autoFocus placeholder="e.g. Jurumani Solutions" className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>Category</span>
                <input name="category" placeholder="e.g. Networking" className={FIELD} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>Contact</span>
                  <input name="contact_name" placeholder="Name" className={FIELD} />
                </label>
                <label className="block">
                  <span className={LABEL}>Email</span>
                  <input name="email" type="email" placeholder="name@supplier.com" className={FIELD} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>Phone</span>
                  <input name="phone" className={FIELD} />
                </label>
                <label className="block">
                  <span className={LABEL}>Website</span>
                  <input name="website" placeholder="supplier.com" className={FIELD} />
                </label>
              </div>
              <label className="block">
                <span className={LABEL}>Notes</span>
                <textarea name="notes" rows={2} className={FIELD} />
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
      {pending ? "Adding…" : "Add supplier"}
    </button>
  );
}
