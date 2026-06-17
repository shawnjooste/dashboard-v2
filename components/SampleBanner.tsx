const CALENDLY_URL = "https://calendly.com/shawn-rocking/portal-discovery-call";

/** Shown above Devices / M365 (and the home cards) when a client has no real
 *  data yet. Plain server component — the CTA is a simple link (opens the
 *  Calendly discovery call in a new tab). */
export function SampleBanner() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[#F3CE84] bg-[#FEF6E7] px-4 py-3">
      <span className="rounded-full bg-[#B8770C] px-2 py-px text-[11px] font-bold uppercase tracking-[0.5px] text-white">
        Sample data
      </span>
      <span className="text-[13.5px] text-[#7A5B12]">
        This is example data — a preview of what Rocking keeps an eye on for you once you&rsquo;re set up.
      </span>
      <a
        href={CALENDLY_URL}
        target="_blank"
        rel="noreferrer"
        className="ml-auto shrink-0 text-[13px] font-semibold text-[#8A4B0A] underline-offset-2 hover:underline"
      >
        Book a 15-min chat →
      </a>
    </div>
  );
}
