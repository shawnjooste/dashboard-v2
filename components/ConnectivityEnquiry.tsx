"use client";

import { useActionState } from "react";
import { submitConnectivityEnquiry, type EnquiryResult } from "@/app/(app)/connectivity/actions";
import { Card } from "@/components/ui";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD =
  "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

/** Shown on /connectivity when the client has no active lines. Replaces what
 *  used to be a dead end ("No connectivity services on your account yet.")
 *  with a pitch and a coverage enquiry that lands on the RFQ board.
 *
 *  No prices: SA connectivity pricing is address-dependent, so quoting blind
 *  would mislead. */
export function ConnectivityEnquiry({
  contactName,
  contactEmail,
}: {
  contactName: string;
  contactEmail: string;
}) {
  const [state, formAction, pending] = useActionState<EnquiryResult | null, FormData>(
    submitConnectivityEnquiry,
    null,
  );

  if (state?.ok) {
    return (
      <Card>
        <div className="px-4 py-6">
          <p className="text-sm font-semibold text-ink">We&rsquo;ve got it.</p>
          <p className="mt-1 text-sm text-muted">
            We&rsquo;ll check what&rsquo;s available at that address and come back to you with options.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="px-4 py-5">
        <p className="text-sm font-semibold text-ink">Connectivity from Rocking</p>
        <p className="mt-1.5 text-sm text-muted">
          Fibre, wireless and LTE &mdash; sourced, installed and managed by us. Once a line is live it shows up
          right here: speed, uptime, and a call to us the moment it goes down.
        </p>

        <form action={formAction} className="mt-5 space-y-3.5">
          <label className="block">
            <span className={LABEL}>Site address</span>
            <input
              name="address"
              required
              placeholder="Street, suburb, city"
              className={FIELD}
              disabled={pending}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL}>Current provider (optional)</span>
              <input name="provider" placeholder="e.g. Vuma" className={FIELD} disabled={pending} />
            </label>
            <label className="block">
              <span className={LABEL}>Current speed (optional)</span>
              <input name="speed" placeholder="e.g. 50/25 Mbps" className={FIELD} disabled={pending} />
            </label>
          </div>
          <label className="block">
            <span className={LABEL}>Anything else? (optional)</span>
            <textarea name="note" rows={3} className={FIELD} disabled={pending} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL}>Who should we contact</span>
              <input name="contact_name" defaultValue={contactName} className={FIELD} disabled={pending} />
            </label>
            <label className="block">
              <span className={LABEL}>Contact email</span>
              <input
                name="contact_email"
                type="email"
                required
                defaultValue={contactEmail}
                className={FIELD}
                disabled={pending}
              />
            </label>
          </div>

          {state && !state.ok && <p className="text-[13px] text-brand">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
          >
            {pending ? "Sending…" : "Check what's available at my address"}
          </button>
        </form>
      </div>
    </Card>
  );
}
