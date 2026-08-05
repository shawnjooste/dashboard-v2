"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    $crisp?: unknown[];
    CRISP_WEBSITE_ID?: string;
  }
}

/**
 * Crisp live chat for tiers whose package has chat (Partner).
 *
 * Deliberately scoped: the widget only mounts for clients entitled to it, so
 * nobody sees a chat box they can't use. The signed-in identity is pushed
 * straight in — the whole point of chatting from inside the portal is that we
 * already know who you are, so you shouldn't be asked for your email.
 *
 * Crisp is chat only: quick questions that don't deserve a ticket. Nothing
 * here is persisted to the portal, and it never creates tickets.
 */
export function CrispChat({
  websiteId,
  email,
  name,
  company,
  tier,
  incident = null,
}: {
  websiteId: string;
  email: string;
  name: string | null;
  company: string | null;
  tier: string | null;
  /** Set when chat is only open because an incident opened it — tells the
   *  agent why someone on the free tier is in the chat at all. */
  incident?: string | null;
}) {
  useEffect(() => {
    if (!websiteId) return;
    window.$crisp = window.$crisp ?? [];
    window.CRISP_WEBSITE_ID = websiteId;

    if (!document.getElementById("crisp-loader")) {
      const s = document.createElement("script");
      s.id = "crisp-loader";
      s.src = "https://client.crisp.chat/l.js";
      s.async = true;
      document.head.appendChild(s);
    }

    // Identify: no email prompt, and the agent sees who's asking.
    window.$crisp.push(["set", "user:email", [email]]);
    if (name) window.$crisp.push(["set", "user:nickname", [name]]);
    if (company) window.$crisp.push(["set", "user:company", [company]]);
    window.$crisp.push([
      "set",
      "session:data",
      [
        [
          ["client", company ?? "—"],
          ["tier", tier ?? "—"],
          ["source", incident ? "portal (incident)" : "portal"],
          ...(incident ? [["incident", incident]] : []),
        ],
      ],
    ]);
  }, [websiteId, email, name, company, tier, incident]);

  return null;
}
