# Incident mode — design

**Date:** 2026-08-05
**Status:** approved, built

## The problem

Live chat (Crisp) is a Partner-tier perk. During an outage that's exactly
backwards: the people who most need to reach us quickly are the ones who
can't, and every one of them raises a ticket asking the same question.

We wanted a way to open chat to everyone for the duration of an outage, and —
the harder half — to be sure it closes again afterwards.

## The decision

**Incident mode is not a switch of its own. It's a flag on an incident.**

`status_incidents` gains one column, `opens_chat`. While an incident with that
flag is active, everyone who can see it gets the chat widget regardless of
their support package. Resolving the incident closes chat again.

This was chosen over a standalone admin toggle for three reasons:

1. **It cannot be left on.** The only way to keep chat open is to leave an
   incident unresolved, which is visible on the admin status page. A separate
   toggle is a commercial leak waiting to be forgotten.
2. **Scope comes free.** A `global` incident opens chat to everyone; a
   `clients`-scoped one opens it only to the clients it targets. A fibre break
   at one client does not hand chat to all 179. RLS already enforces this, so
   the feature inherits it rather than reimplementing it.
3. **The announcement comes free.** Posting an incident already emails
   subscribers, updates /status and colours the top-bar dot. Chat opening is a
   property of the incident, not a thing bolted next to it.

The rejected alternative — ticking `has_chat` on the Standard package — works
today with no code, but edits the price list to do an operational job and
leaves nothing on screen to say it's on.

## The banner

An active incident used to be a 7px dot in the top bar. That is too quiet for
an outage, and far too quiet to tell a free-tier client that chat — which they
have never seen — is now available.

So: a full-width brand-red bar above the app, carrying the incident title, a
link to the updates, and a **Chat to us now** button when chat is open.

**Outages only.** Degraded service and scheduled maintenance stay behind the
dot, so the bar keeps meaning "something is actually broken". The single
exception is any incident that opened chat, whatever its type — a chat widget
appearing from nowhere with no explanation is worse than a banner.

## Shape

- `supabase/migrations/0081_incident_opens_chat.sql` — the column.
- `lib/incident-mode.ts` — the whole decision, pure and tested:
  `chatOpenedByIncident()` and `bannerIncident()`.
- `lib/views/status.ts` — `getActiveIncidents()`, RLS-scoped, never throws.
  One read per page feeds all three shell decisions (dot colour, banner, chat).
- `lib/actions/status.ts` — `postIncident` reads the checkbox.
- `components/status/StaffControls.tsx` — the checkbox; `StatusView` shows a
  staff-only "Chat open" chip on the active incident.
- `components/IncidentBanner.tsx` — the bar; opens Crisp via `$crisp`.
- `app/(app)/layout.tsx` — mounts Crisp when the package has chat **or** an
  incident opened it, and passes the incident title into the Crisp session so
  the agent knows why a free-tier client is in the chat.

## Deliberate omissions

- **No incident-free override.** If it's worth opening chat it's worth a
  one-line incident, and that's what makes it self-closing.
- **Staff don't get the banner.** They post it; they see it on /admin/status.
- **Users with no company don't get the banner.** That branch of the layout is
  client-scoped and returns early.
- **Failure is quiet.** If the incident query fails, the portal renders with no
  banner and no chat override — never a broken page.

## Operational note

Opening chat during a global outage takes the audience from ~3 Partner clients
to every client in the portal, at the exact moment volume spikes. Crisp seat
and conversation limits should be checked before this is first used in anger.
