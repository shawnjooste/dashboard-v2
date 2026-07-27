/** The support & escalation procedure — a yellow reference block on the
 *  Support page. Wording agreed with Shawn 2026-07-21; step 2 deliberately
 *  has no timeframe. */
export function SupportEscalation() {
  return (
    <div className="rounded-lg bg-warn-tint px-4 py-3.5">
      <p className="text-[13px] font-semibold uppercase tracking-[0.5px] text-warn-ink">
        Support &amp; escalation
      </p>
      <ol className="mt-2 space-y-1.5 text-sm text-warn-ink">
        <li>
          <span className="font-semibold">1. Log a ticket</span> — right here in the portal, by email to{" "}
          <a href="mailto:support@rocking.co.za" className="font-medium underline">
            support@rocking.co.za
          </a>
          , or WhatsApp <span className="font-medium">069 653 4035</span>. This is always the fastest way to get help —
          tickets go straight to the whole team.
        </li>
        <li>
          <span className="font-semibold">2. No response?</span> Call our support line on{" "}
          <span className="font-medium">0860 995 113</span>.
        </li>
        <li>
          <span className="font-semibold">3. Still stuck?</span> Call Shawn directly on{" "}
          <span className="font-medium">079 108 1920</span>.
        </li>
      </ol>
    </div>
  );
}
