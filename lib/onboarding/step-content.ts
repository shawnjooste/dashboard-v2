/** Copy for each catalogue step.
 *
 *  Every one of these can arrive on day 7 of a tour OR months later, the first
 *  time a feature is switched on for someone. So none of them may mention
 *  being new, being welcomed, or where they sit in the sequence — they simply
 *  explain one part of the portal. */
import { onboardingEmailHtml, type OnboardingFeature } from "../onboarding-email";

type Copy = {
  headline: string;
  preheader: string;
  intro: (company: string, firstName: string) => string;
  eyebrow: string;
  ctaLabel: string;
  features: OnboardingFeature[];
};

// onboardingEmailHtml escapes firstName, companyName, headline, eyebrow,
// ctaLabel, preheader and feature text. `intro` is inserted as HTML, so the
// company name is escaped here before it goes in.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const COPY: Record<string, Copy> = {
  support: {
    headline: "Getting help, without the phone tag",
    preheader: "How to raise a request and follow it through.",
    intro: (company, firstName) =>
      `Hi ${esc(firstName)}. Anything ${esc(company)} needs from us can start right here &mdash; described in plain English, tracked in one place, and answered by a real person.`,
    eyebrow: "How it works",
    ctaLabel: "Raise a request",
    features: [
      { title: "Say what you need, plainly", body: "No forms full of jargon and no ticket numbers to remember — just tell us what's wrong." },
      { title: "Watch it move", body: "See what we're doing about it and reply in the same place, without digging through your inbox." },
      { title: "Keep the history", body: "Every request and how it was resolved stays together, so nothing has to be re-explained." },
    ],
  },
  devices: {
    headline: "Your computers, and how safe they are",
    preheader: "What we can see about the machines we look after.",
    intro: (company, firstName) =>
      `Hi ${esc(firstName)}. Every machine we look after for ${esc(company)} reports in &mdash; so you can see what you own, who uses it, and whether it&rsquo;s protected, without asking anyone.`,
    eyebrow: "What you'll find",
    ctaLabel: "Open Devices",
    features: [
      { title: "Every machine, listed", body: "What each one is, who last used it, and when we last heard from it." },
      { title: "Whether it's protected", body: "Antivirus and updates, at a glance — so a machine falling behind is obvious rather than invisible." },
      { title: "Photos and condition", body: "We add a photo and the condition of each machine as we handle it, which makes an audit or an insurance claim much less painful." },
    ],
  },
  billing: {
    headline: "Your invoices and balance, whenever you want them",
    preheader: "Every invoice and what's outstanding, in one place.",
    intro: (company, firstName) =>
      `Hi ${esc(firstName)}. The billing page shows what ${esc(company)} owes and every invoice behind it &mdash; no waiting on an email and no need to ask.`,
    eyebrow: "What's on the page",
    ctaLabel: "Open Billing",
    features: [
      { title: "What's outstanding", body: "Your balance and anything overdue, right at the top." },
      { title: "Every invoice", body: "Paid and unpaid, going back — open any one of them without hunting through email." },
      { title: "Always current", body: "It reads straight from our accounts, so it matches what we see." },
    ],
  },
  connectivity: {
    headline: "Seeing your connection, live",
    preheader: "Whether your line is up, and where a fault actually sits.",
    intro: (company, firstName) =>
      `Hi ${esc(firstName)}. The connectivity page tells you whether the line at ${esc(company)} is healthy right now &mdash; and, when something is wrong, where the problem actually is rather than who to blame.`,
    eyebrow: "What it shows",
    ctaLabel: "Open Connectivity",
    features: [
      { title: "Up or down, right now", body: "Live status and response time, with the last 24 hours drawn out so you can tell a blip from a pattern." },
      { title: "Where the fault sits", body: "Your connection is drawn hop by hop, so a problem shows up in one place instead of being a guess." },
      { title: "Not with us yet?", body: "If we don't provide your line, the page will ask for your address and we'll come back with what's available there." },
    ],
  },
  team: {
    headline: "Adding your colleagues to the portal",
    preheader: "Invite the people who should see this too.",
    intro: (company, firstName) =>
      `Hi ${esc(firstName)}. You can invite anyone at ${esc(company)} to the portal yourself, and decide how much they see.`,
    eyebrow: "What you can do",
    ctaLabel: "Open Team",
    features: [
      { title: "Invite in seconds", body: "Add a colleague's email and they get their own sign-in — no request to us needed." },
      { title: "Choose what they see", body: "Managers get the full picture; members get support and their own machine, and nothing else." },
      { title: "Remove people just as easily", body: "When someone leaves, take their access away from the same page." },
    ],
  },
};

/** Rendered HTML for a step, or null when the key is unknown. */
export function stepEmailHtml(
  stepKey: string,
  opts: { firstName: string; companyName: string; portalUrl: string },
): string | null {
  const copy = COPY[stepKey];
  if (!copy) return null;
  return onboardingEmailHtml({
    firstName: opts.firstName,
    companyName: opts.companyName,
    portalUrl: opts.portalUrl,
    headline: copy.headline,
    // onboardingEmailHtml's default <title> reads "Welcome to The Portal",
    // which would break the copy rule for a step fired months after
    // enrolment — override it with the same non-time-bound headline.
    title: copy.headline,
    preheader: copy.preheader,
    intro: copy.intro(opts.companyName, opts.firstName),
    eyebrow: copy.eyebrow,
    ctaLabel: copy.ctaLabel,
    features: copy.features,
  });
}
