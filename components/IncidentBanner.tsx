"use client";

/** The outage bar across the top of the portal.
 *
 *  Deliberately loud — full-width brand red, above everything. It only ever
 *  appears for an outage (degraded and maintenance stay behind the status dot),
 *  so it keeps meaning "something is actually broken" rather than becoming
 *  furniture people scroll past.
 *
 *  When the incident opened chat, the bar is also the way in: a client on the
 *  free tier has never seen the widget before and won't go looking for it. */
export function IncidentBanner({
  title,
  chatOpen,
  statusHref = "/status",
}: {
  title: string;
  chatOpen: boolean;
  statusHref?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-brand px-4 py-2.5 text-sm text-white print:hidden">
      <span>
        <strong>{title}</strong> — we&rsquo;re aware of this and working on it.
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {chatOpen && (
          <button
            type="button"
            // The widget is already loaded by this point (the layout mounts it
            // whenever an incident opens chat), so this just opens it.
            onClick={() => {
              const crisp = window.$crisp;
              if (Array.isArray(crisp)) crisp.push(["do", "chat:open"]);
            }}
            className="rounded border border-white/50 px-3 py-0.5 font-semibold hover:bg-white/10"
          >
            Chat to us now
          </button>
        )}
        <a href={statusHref} className="rounded border border-white/50 px-3 py-0.5 font-medium hover:bg-white/10">
          Latest updates
        </a>
      </span>
    </div>
  );
}
