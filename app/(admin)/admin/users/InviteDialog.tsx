"use client";

import { useActionState, useEffect, useState } from "react";
import { inviteUser, type InviteResult } from "./actions";

type ClientRef = { id: string; name: string };

/** "+ Invite" button + modal. Provisions a user and sends the onboarding email
 *  with a one-click sign-in link via the inviteUser server action. */
export function InviteDialog({
  clients,
  defaultClientId,
}: {
  clients: ClientRef[];
  defaultClientId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<InviteResult | null, FormData>(inviteUser, null);

  // Auto-close shortly after a successful send.
  useEffect(() => {
    if (state?.ok) {
      const t = setTimeout(() => setOpen(false), 1600);
      return () => clearTimeout(t);
    }
  }, [state]);

  const field =
    "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[10px] border border-line bg-card px-3.5 py-[9px] text-sm font-semibold text-ink-2 transition-colors hover:border-faint"
      >
        + Invite
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-ink">Invite to The Portal</h2>
            <p className="mt-1 text-[13.5px] text-muted">
              They&rsquo;ll get a branded welcome email with a one-click sign-in link — no password.
            </p>

            <form action={action} className="mt-5 space-y-3.5">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">Email</span>
                <input name="email" type="email" required autoFocus placeholder="name@company.co.za" className={field} />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">Full name (optional)</span>
                <input name="name" type="text" placeholder="Monique Siers" className={field} />
                <span className="mt-1 block text-[11.5px] text-faint">If set, they skip the name step on first login.</span>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">Client</span>
                <select name="client_id" required defaultValue={defaultClientId ?? ""} className={field}>
                  <option value="" disabled>Choose a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>

              {state && !state.ok && (
                <p className="rounded-lg bg-brand-tint px-3 py-2 text-[13px] font-medium text-[#B01218]">{state.error}</p>
              )}
              {state?.ok && (
                <p className="rounded-lg bg-[#E9F7EF] px-3 py-2 text-[13px] font-medium text-good">
                  Invitation sent to {state.email}.
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
                >
                  {pending ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
