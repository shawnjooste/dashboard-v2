"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createJob } from "./actions";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

export function NewJobDialog({
  clients,
  staff,
}: {
  clients: { id: string; name: string }[];
  staff: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-[10px] bg-ink px-3.5 py-[9px] text-sm font-semibold text-white transition-colors hover:bg-black"
      >
        + New job
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[10vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-ink">New job</h2>
            <form action={createJob} className="mt-4 space-y-3.5">
              <label className="block">
                <span className={LABEL}>Client</span>
                <select name="client_id" required defaultValue="" className={FIELD}>
                  <option value="" disabled>
                    Choose a client…
                  </option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={LABEL}>Title</span>
                <input name="title" required autoFocus placeholder="e.g. Catalyst switch install" className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>Owner</span>
                <select name="owner_profile_id" defaultValue="" className={FIELD}>
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={LABEL}>Checklist (one per line, optional)</span>
                <textarea name="tasks" rows={3} placeholder={"Place supplier order\nSchedule install"} className={FIELD} />
              </label>
              <label className="block">
                <span className={LABEL}>Internal notes (optional)</span>
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
      {pending ? "Creating…" : "Create job"}
    </button>
  );
}
