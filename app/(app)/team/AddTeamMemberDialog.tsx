"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { inviteTeamMember, type InviteTeamResult } from "./actions";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

export function AddTeamMemberDialog({ domain }: { domain: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<InviteTeamResult | null, FormData>(inviteTeamMember, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-[10px] border border-line bg-card px-3.5 py-[9px] text-sm font-semibold text-ink-2 transition-colors hover:bg-line-soft"
      >
        + Add team member
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[10vh]" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-ink">Add a team member</h2>
            <p className="mt-1 text-[13px] text-muted">
              We&rsquo;ll email them a one-click invite to the portal.
              {domain ? <> They must have an <span className="font-semibold text-ink-2">@{domain}</span> email address.</> : null}
            </p>

            <form ref={formRef} action={action} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={LABEL}>First name</span>
                  <input name="first_name" required autoFocus className={FIELD} />
                </label>
                <label className="block">
                  <span className={LABEL}>Surname</span>
                  <input name="last_name" className={FIELD} />
                </label>
              </div>
              <label className="block">
                <span className={LABEL}>Email</span>
                <input name="email" type="email" required placeholder={domain ? `name@${domain}` : "name@company.com"} className={FIELD} />
              </label>

              {state && !state.ok && (
                <p className="rounded-md bg-brand-tint px-3 py-1.5 text-[13px] font-medium text-[#B01218]">{state.error}</p>
              )}
              {state?.ok && (
                <p className="rounded-md bg-[#E9F7EF] px-3 py-1.5 text-[13px] font-medium text-good">
                  Invite sent to {state.email}.
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft"
                >
                  Close
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
      {pending ? "Sending…" : "Send invite"}
    </button>
  );
}
