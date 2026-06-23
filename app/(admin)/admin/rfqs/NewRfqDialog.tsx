"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createRfq } from "./actions";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

export function NewRfqDialog({ clients }: { clients: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [hasClient, setHasClient] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-[10px] bg-ink px-3.5 py-[9px] text-sm font-semibold text-white transition-colors hover:bg-black"
      >
        + New RFQ
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-ink">New RFQ</h2>
            <p className="mt-1 text-[13px] text-muted">A request that came in — from a customer or your team.</p>
            <form action={createRfq} className="mt-4 space-y-3.5">
              <label className="block">
                <span className={LABEL}>Title</span>
                <input name="title" required autoFocus placeholder="e.g. 10× Dell Micro PCs" className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>Client (optional)</span>
                <select
                  name="client_id"
                  defaultValue=""
                  onChange={(e) => setHasClient(!!e.target.value)}
                  className={FIELD}
                >
                  <option value="">No client / prospect</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {!hasClient && (
                <label className="block">
                  <span className={LABEL}>…or prospect name</span>
                  <input name="client_name" placeholder="e.g. Acme (not yet a client)" className={FIELD} />
                </label>
              )}
              <label className="block">
                <span className={LABEL}>Requested by</span>
                <input name="requested_by" placeholder="customer contact or team member" className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>What they want</span>
                <textarea name="description" rows={3} className={FIELD} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>Needed by (optional)</span>
                  <input name="needed_by" type="date" className={FIELD} />
                </label>
                <label className="block">
                  <span className={LABEL}>Waiting on (optional)</span>
                  <input name="sourcing_note" placeholder="e.g. Jurumani" className={FIELD} />
                </label>
              </div>

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
      {pending ? "Creating…" : "Create RFQ"}
    </button>
  );
}
