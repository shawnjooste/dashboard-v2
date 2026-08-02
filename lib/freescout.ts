// Server-only FreeScout REST client. FreeScout is the single source of truth —
// no mirror tables, no sync. The API key is staff-level, so AUTHORIZATION IS
// OURS: every page/action must scope access via getSupportScope() +
// lib/freescout-scope helpers before proxying.

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";

const PORTAL_MAILBOX_ID = 1; // "Email Support" <support@rocking.co.za>

function fsConfig() {
  const url = process.env.FREESCOUT_URL;
  const key = process.env.FREESCOUT_API_KEY;
  if (!url || !key) throw new Error("FreeScout env vars are not configured");
  return { url, key };
}

/** FreeScout now sits behind a Cloudflare Tunnel with an Access (Service Auth)
 *  policy — the origin has no public ingress, and Cloudflare's edge rejects
 *  anything without a valid service token before it reaches FreeScout. These
 *  headers are what identify the portal. Absent env vars = no headers, so this
 *  is a no-op on a directly-reachable instance (local dev, or pre-cutover). */
function accessHeaders(): Record<string, string> {
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  return id && secret ? { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } : {};
}

async function fsFetch(path: string, init?: RequestInit): Promise<Response> {
  const { url, key } = fsConfig();
  return fetch(`${url}/api${path}`, {
    ...init,
    headers: {
      "X-FreeScout-API-Key": key,
      "Content-Type": "application/json",
      ...accessHeaders(),
      ...init?.headers,
    },
    cache: "no-store",
  });
}

export type TicketSummary = {
  id: number;
  number: number;
  subject: string;
  status: string;
  preview: string;
  customerEmail: string | null;
  updatedAt: string;
};

export type TicketThread = {
  id: number;
  type: "customer" | "message";
  body: string;
  createdAt: string;
  authorName: string;
};

export type TicketDetail = {
  id: number;
  subject: string;
  status: string;
  customerEmail: string | null;
  threads: TicketThread[];
};

type FsConversation = {
  id: number;
  number: number;
  subject: string | null;
  status: string;
  preview: string | null;
  updatedAt: string | null;
  createdAt: string;
  customer: { email?: string; firstName?: string; lastName?: string } | null;
  _embedded?: { threads?: FsThread[] };
};

type FsThread = {
  id: number;
  type: string;
  body: string | null;
  createdAt: string;
  createdBy: { firstName?: string; lastName?: string; email?: string } | null;
  customer: { firstName?: string; lastName?: string; email?: string } | null;
};

function toSummary(c: FsConversation): TicketSummary {
  return {
    id: c.id,
    number: c.number,
    subject: c.subject ?? "(no subject)",
    status: c.status,
    preview: c.preview ?? "",
    customerEmail: c.customer?.email?.toLowerCase() ?? null,
    updatedAt: c.updatedAt ?? c.createdAt,
  };
}

async function listConversations(params: Record<string, string>): Promise<TicketSummary[]> {
  const qs = new URLSearchParams({
    status: "all",
    sortField: "updatedAt",
    sortOrder: "desc",
    pageSize: "100",
    ...params,
  });
  const res = await fsFetch(`/conversations?${qs}`);
  if (!res.ok) throw new Error(`FreeScout list failed (${res.status})`);
  const data = await res.json();
  const convs: FsConversation[] = data?._embedded?.conversations ?? [];
  return convs.map(toSummary);
}

export const listConversationsByEmail = (email: string) =>
  listConversations({ customerEmail: email });

/**
 * Most recent conversations across the helpdesk, for manager domain-filtering.
 * v1 limitation: only the most recent 100 conversations are scanned.
 */
export const listRecentConversations = () => listConversations({});

/**
 * Every conversation created on/after `sinceIso`, paging past the 100-row
 * window the other listers accept. Used where a count has to be right —
 * "how many tickets has this client raised this month" is a commercial
 * signal, and a truncated list would silently undercount the busiest clients.
 * Capped at 20 pages (2000 conversations) so a runaway can't hang a job.
 */
export async function listConversationsSince(sinceIso: string): Promise<TicketSummary[]> {
  const out: TicketSummary[] = [];
  const since = new Date(sinceIso).getTime();
  for (let page = 1; page <= 20; page++) {
    const batch = await listConversations({ page: String(page) });
    out.push(...batch);
    // Sorted by updatedAt desc, so once a whole page predates the window
    // there's nothing newer further back.
    if (batch.length < 100) break;
    const oldest = batch[batch.length - 1];
    if (oldest && new Date(oldest.updatedAt).getTime() < since) break;
  }
  return out.filter((c) => new Date(c.updatedAt).getTime() >= since);
}

export async function getConversation(id: number): Promise<TicketDetail | null> {
  const res = await fsFetch(`/conversations/${id}?embed=threads`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`FreeScout get failed (${res.status})`);
  const c: FsConversation = await res.json();
  const threads: TicketThread[] = (c._embedded?.threads ?? [])
    .filter((t) => t.type === "customer" || t.type === "message")
    .map((t) => ({
      id: t.id,
      type: t.type as "customer" | "message",
      body: t.body ?? "",
      createdAt: t.createdAt,
      authorName:
        t.type === "customer"
          ? [t.customer?.firstName, t.customer?.lastName].filter(Boolean).join(" ") || "You"
          : [t.createdBy?.firstName, t.createdBy?.lastName].filter(Boolean).join(" ") || "Rocking support",
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    id: c.id,
    subject: c.subject ?? "(no subject)",
    status: c.status,
    customerEmail: c.customer?.email?.toLowerCase() ?? null,
    threads,
  };
}

export async function createTicket(opts: {
  email: string;
  subject: string;
  message: string;
  /** e.g. ["tier:business_care"] — priority visible where the team works. */
  tags?: string[];
}): Promise<number> {
  const res = await fsFetch(`/conversations`, {
    method: "POST",
    body: JSON.stringify({
      type: "email",
      mailboxId: PORTAL_MAILBOX_ID,
      subject: opts.subject,
      customer: { email: opts.email },
      threads: [{ type: "customer", text: opts.message, customer: { email: opts.email } }],
      status: "active",
    }),
  });
  if (!res.ok) throw new Error(`FreeScout create failed (${res.status})`);
  const data = await res.json();
  const id = data.id as number;
  // FreeScout ignores tags on create — they go via a follow-up PUT, which
  // requires the (official) Tags module to be active. Tagging is best-effort:
  // a failure must never lose the ticket itself.
  if (opts.tags?.length) {
    try {
      await fsFetch(`/conversations/${id}/tags`, {
        method: "PUT",
        body: JSON.stringify({ tags: opts.tags }),
      });
    } catch {
      // ticket exists untagged; the team just won't see a tier chip on it
    }
  }
  return id;
}

/** Internal (staff-only) note on a conversation — records a paid session
 *  against the ticket it belongs to, so there's no duplicate thread. */
export async function addTicketNote(
  conversationId: number,
  text: string,
  authorEmail?: string,
): Promise<void> {
  const user = (authorEmail ? await freescoutUserId(authorEmail) : null) ?? 1;
  const res = await fsFetch(`/conversations/${conversationId}/threads`, {
    method: "POST",
    body: JSON.stringify({ type: "note", text, user }),
  });
  if (!res.ok) throw new Error(`FreeScout note failed (${res.status})`);
}

/** Staff reply to the customer, attributed to the staff member when we can
 *  match them to a FreeScout account. */
export async function replyAsStaff(
  conversationId: number,
  text: string,
  authorEmail: string,
): Promise<void> {
  const user = (await freescoutUserId(authorEmail)) ?? 1;
  const res = await fsFetch(`/conversations/${conversationId}/threads`, {
    method: "POST",
    body: JSON.stringify({ type: "message", text, user }),
  });
  if (!res.ok) throw new Error(`FreeScout staff reply failed (${res.status})`);
}

/** FreeScout user id for a staff email, so replies and notes are attributed to
 *  the person who actually wrote them rather than a generic agent. Cached per
 *  lambda instance — the user list changes about once a year. Null when the
 *  address has no FreeScout account; callers fall back to the default agent. */
let fsUserCache: Map<string, number> | null = null;
export async function freescoutUserId(email: string): Promise<number | null> {
  if (!fsUserCache) {
    try {
      const res = await fsFetch(`/users?pageSize=100`);
      if (!res.ok) return null;
      const data = await res.json();
      const users: { id: number; email?: string }[] = data?._embedded?.users ?? [];
      // Deleted accounts linger with a mangled address
      // ("tim@rocking.one_deleted20250812143755") — skip them, or a tombstone
      // could shadow the live user and misattribute their replies.
      fsUserCache = new Map(
        users
          .filter((u) => u.email && !u.email.includes("_deleted"))
          .map((u) => [u.email!.toLowerCase(), u.id]),
      );
    } catch (e) {
      console.error("FreeScout user lookup failed:", e);
      return null;
    }
  }
  return fsUserCache.get(email.toLowerCase()) ?? null;
}

/** Set a conversation's status (active | pending | closed). */
export async function setConversationStatus(
  conversationId: number,
  status: "active" | "pending" | "closed",
): Promise<void> {
  const res = await fsFetch(`/conversations/${conversationId}`, {
    method: "PUT",
    body: JSON.stringify({ status, byUser: 1 }),
  });
  if (!res.ok) throw new Error(`FreeScout status change failed (${res.status})`);
}

/** Reopen a closed conversation — a paid session means it's live work again. */
export async function reopenTicket(conversationId: number): Promise<void> {
  await setConversationStatus(conversationId, "active");
}

export async function replyToTicket(id: number, email: string, message: string): Promise<void> {
  const res = await fsFetch(`/conversations/${id}/threads`, {
    method: "POST",
    body: JSON.stringify({ type: "customer", text: message, customer: { email } }),
  });
  if (!res.ok) throw new Error(`FreeScout reply failed (${res.status})`);
}

export type SupportScope = {
  email: string;
  isManager: boolean;
  clientDomains: string[];
};

/**
 * Resolves the caller's support scope: their email, and (managers) their
 * client's registered email domains. Returns null when unauthenticated.
 */
export async function getSupportScope(): Promise<SupportScope | null> {
  const me = await getCurrentProfile();
  if (!me.authenticated) return null;
  const isManager = me.profile.role === "client_manager";
  let clientDomains: string[] = [];
  if (isManager && me.profile.client_id) {
    const supabase = await createClient();
    const { data } = await supabase.from("client_domains").select("domain");
    clientDomains = (data ?? []).map((d) => d.domain.toLowerCase());
  }
  return { email: me.profile.email.toLowerCase(), isManager, clientDomains };
}
