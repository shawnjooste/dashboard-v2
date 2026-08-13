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

  if (!websiteId) return null;

  // Crisp's own $crisp config API only offers "position:reverse" (swap left
  // <-> right) and "hide:on:mobile" (remove the launcher entirely) — neither
  // moves it out of the way, and hiding it defeats the point on the tier
  // (and incident-mode) clients this is for. So this is a CSS override, and
  // it's genuinely fragile: verified against the live widget on
  // docs.crisp.chat, Crisp assigns the launcher a build-hashed class (e.g.
  // "cc-13wro") that changes across their releases — the exact thing this
  // selector avoids depending on. Anchored instead on:
  //   - #crisp-chatbox: the hardcoded mount id their own loader script
  //     creates; effectively part of their public integration contract.
  //   - [data-maximized]: an internal state attribute that, at the time of
  //     writing, sits uniquely on the launcher toggle (open or closed) and
  //     nowhere else inside #crisp-chatbox — confirmed by walking the live
  //     DOM, not from documentation, because Crisp doesn't document it.
  // Neither is a published API. If Crisp renames/removes data-maximized, or
  // moves the widget into a shadow root, this selector silently stops
  // matching and the launcher just reverts to covering the tab bar again —
  // it won't break the build or throw, but it will need re-verifying against
  // the live widget after any Crisp script update.
  return (
    <style>{`
      @media (max-width: 767px) {
        #crisp-chatbox [data-maximized] {
          bottom: calc(56px + env(safe-area-inset-bottom) + 12px) !important;
        }
      }
    `}</style>
  );
}
