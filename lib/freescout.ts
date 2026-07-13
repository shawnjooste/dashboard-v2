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

async function fsFetch(path: string, init?: RequestInit): Promise<Response> {
  const { url, key } = fsConfig();
  return fetch(`${url}/api${path}`, {
    ...init,
    headers: {
      "X-FreeScout-API-Key": key,
      "Content-Type": "application/json",
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
      ...(opts.tags?.length ? { tags: opts.tags } : {}),
    }),
  });
  if (!res.ok) throw new Error(`FreeScout create failed (${res.status})`);
  const data = await res.json();
  return data.id as number;
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
