"use client";

import { useEffect } from "react";

const CALENDLY_URL = "https://calendly.com/shawn-rocking/portal-discovery-call";

type CalendlyWindow = Window & { Calendly?: { initPopupWidget: (o: { url: string }) => void } };

/** Shown above Devices / M365 (and the home cards) when a client has no real
 *  data yet, so prospects see a live preview of the product. The CTA opens the
 *  Calendly discovery call as an in-portal popup. The widget assets load
 *  client-side (in an effect) so nothing Calendly-specific renders during SSR. */
export function SampleBanner() {
  useEffect(() => {
    if (document.getElementById("calendly-widget-js")) return;
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://assets.calendly.com/assets/external/widget.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.id = "calendly-widget-js";
    js.src = "https://assets.calendly.com/assets/external/widget.js";
    js.async = true;
    document.body.appendChild(js);
  }, []);

  const openCalendly = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const w = window as CalendlyWindow;
    if (w.Calendly) w.Calendly.initPopupWidget({ url: CALENDLY_URL });
    else window.open(CALENDLY_URL, "_blank", "noopener");
  };

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
        onClick={openCalendly}
        className="ml-auto shrink-0 cursor-pointer text-[13px] font-semibold text-[#8A4B0A] underline-offset-2 hover:underline"
      >
        Book a 15-min chat →
      </a>
    </div>
  );
}
