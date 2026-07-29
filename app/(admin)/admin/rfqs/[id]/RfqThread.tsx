"use client";

import { useState } from "react";
import type { RfqMessage } from "@/lib/views/rfqs";

const fmt = (ts: string) => {
  const [d, t] = ts.replace("T", " ").split(" ");
  return `${d} ${t.slice(0, 5)}`;
};

/** The supplier exchange for an RFQ — our requests and their replies in one
 *  thread. Long messages collapse; inbound is rendered as plain text (it's
 *  third-party HTML, so we never inject it into the page). */
export function RfqThread({ messages }: { messages: RfqMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="px-4 py-4 text-[13px] text-muted">
        No emails on this RFQ yet. Anything sent to or received from the supplier through
        quotes@send.rocking.one will appear here.
      </p>
    );
  }
  return (
    <div className="divide-y divide-line-soft">
      {messages.map((m) => (
        <Message key={m.id} m={m} />
      ))}
    </div>
  );
}

function Message({ m }: { m: RfqMessage }) {
  const [open, setOpen] = useState(false);
  const out = m.direction === "out";
  const text = m.isHtml ? htmlToText(m.body) : (m.body ?? "");
  const long = text.length > 420;
  const shown = open || !long ? text : text.slice(0, 420).trimEnd() + "…";

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`rounded-full px-2 py-[2px] text-[11px] font-semibold ${
            out ? "bg-brand-tint text-brand" : "bg-good-tint text-good"
          }`}
        >
          {out ? "Rocky →" : "← Reply"}
        </span>
        <span className="text-[13px] font-medium text-ink">{m.party}</span>
        <span className="ml-auto text-xs text-faint">{fmt(m.at)}</span>
      </div>
      {m.subject && <div className="mt-1 text-[12.5px] text-ink-3">{m.subject}</div>}
      {shown && (
        <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.5] text-ink-2">
          {shown}
        </pre>
      )}
      {m.attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {m.attachments.map((a, i) => (
            <span key={i} className="rounded border border-line px-1.5 py-[2px] text-[11.5px] text-muted">
              📎 {a.filename ?? "attachment"}
            </span>
          ))}
        </div>
      )}
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 text-[12px] font-semibold text-brand hover:text-brand-dark"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** Our own outbound HTML → readable text (we author it, so this is only
 *  about readability, not safety). */
function htmlToText(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
