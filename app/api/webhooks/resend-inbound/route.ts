import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyInboundRfqEmail } from "@/lib/rfq-notify";

/**
 * Resend inbound-email webhook for quotes@send.rocking.one. The webhook
 * payload is metadata-only (from/to/subject/message_id/attachment list) — we
 * fetch the full body via the Received Emails API before storing.
 *
 * This route only stores + coarsely classifies each message (mechanical,
 * string-matching only). Actually reading/drafting/sending is judgment work
 * done by a scheduled agent pass over unprocessed rows — never inline here,
 * so the webhook stays fast and Resend's retry-on-non-2xx never re-triggers
 * anything expensive or non-idempotent beyond the DB insert (deduped on
 * message_id).
 */
export async function POST(req: Request) {
  const raw = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("RESEND_WEBHOOK_SECRET not set — rejecting inbound webhook");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "missing signature headers" }, { status: 401 });
  }

  let event: { type?: string; data?: { email_id?: string; from?: string; to?: string[]; subject?: string; message_id?: string } };
  try {
    const wh = new Webhook(secret);
    event = wh.verify(raw, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as typeof event;
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  if (event.type !== "email.received" || !event.data?.email_id) {
    return NextResponse.json({ ignored: event.type ?? "unknown" });
  }

  const emailId = event.data.email_id;

  // Webhook payload is metadata-only — fetch the full received email (body,
  // headers, attachment list) before storing.
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY not set — cannot fetch received email body");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error("failed to fetch received email:", emailId, res.status);
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
  const full = await res.json();

  const fromEmail: string = (full.from ?? "").toLowerCase();
  const toEmail: string = Array.isArray(full.to) ? full.to[0] ?? "" : (full.to ?? "");
  const subject: string = full.subject ?? "";
  const messageId: string | null = full.message_id ?? null;
  const inReplyTo: string | null =
    full.headers?.["in-reply-to"] ?? full.headers?.["In-Reply-To"] ?? null;
  // Real header recipients — full.to is the SMTP envelope (always quotes@),
  // so only the headers say whether we were the To or merely Cc'd.
  const headerTo: string | null = full.headers?.["to"] ?? null;
  const headerCc: string | null = full.headers?.["cc"] ?? null;

  const service = createServiceClient();

  // Dedup: Resend may retry a webhook delivery.
  if (messageId) {
    const { data: existing } = await service
      .from("inbound_emails")
      .select("id")
      .eq("message_id", messageId)
      .maybeSingle();
    if (existing) return NextResponse.json({ ok: true, duplicate: true });
  }

  // Staff send from more than one domain in practice (portal logins are
  // @rocking.one, but day-to-day mail — e.g. forwards — comes from
  // @rocking.co.za too).
  const INTERNAL_DOMAINS = ["@rocking.one", "@rocking.co.za"];
  const isInternal = INTERNAL_DOMAINS.some((d) => fromEmail.endsWith(d));

  // ---------- classify (mechanical only — no judgment here) ----------
  let kind:
    | "client_forward"
    | "staff_supplier_request"
    | "supplier_reply"
    | "client_quote_reply"
    | "supplier_clarification"
    | "unclassified" = "unclassified";
  let rfqId: string | null = null;
  let quoteId: string | null = null;

  // Were we the actual recipient, or just copied in? Staff running their own
  // supplier thread Cc us for visibility; a forward addressed to us is a
  // request to act.
  const ccdOnly = !!headerCc?.toLowerCase().includes("quotes@send.rocking.one");

  // client_quote_reply: In-Reply-To matches a Resend message id we recorded
  // when sending a quote.
  if (inReplyTo) {
    const { data: match } = await service
      .from("quote_events")
      .select("quote_id")
      .eq("resend_message_id", inReplyTo)
      .maybeSingle();
    if (match) {
      kind = "client_quote_reply";
      quoteId = match.quote_id;
    }
  }

  const tokenMatch = subject.match(/RFQ-([a-zA-Z0-9]{6,10})/);

  // supplier_reply: subject contains an open RFQ's tracking token and the
  // sender isn't internal staff.
  if (kind === "unclassified" && !isInternal && tokenMatch) {
    const { data: rfq } = await service
      .from("rfqs")
      .select("id")
      .eq("tracking_token", tokenMatch[1])
      .in("status", ["new", "sourcing"])
      .maybeSingle();
    if (rfq) {
      kind = "supplier_reply";
      rfqId = rfq.id;
    }
  }

  // supplier_reply (no token): a supplier replying into a thread a staff
  // member started themselves. Walk In-Reply-To back to the message we
  // already stored and inherit its RFQ.
  if (kind === "unclassified" && !isInternal && inReplyTo) {
    const { data: parent } = await service
      .from("inbound_emails")
      .select("rfq_id")
      .eq("message_id", inReplyTo)
      .not("rfq_id", "is", null)
      .maybeSingle();
    if (parent?.rfq_id) {
      kind = "supplier_reply";
      rfqId = parent.rfq_id;
    }
  }

  // supplier_clarification: staff replying to "which supplier?" — the
  // pipeline emailed shawn@rocking.one with the pending RFQ's token in the
  // subject because it couldn't resolve a supplier on its own.
  if (kind === "unclassified" && isInternal && tokenMatch) {
    const { data: rfq } = await service
      .from("rfqs")
      .select("id")
      .eq("tracking_token", tokenMatch[1])
      .is("supplier_email", null)
      .maybeSingle();
    if (rfq) {
      kind = "supplier_clarification";
      rfqId = rfq.id;
    }
  }

  // staff_supplier_request: a staff member emailing a supplier directly and
  // Cc'ing us. Observe only — they've already asked, so the pipeline must NOT
  // send its own pricing request or the supplier gets asked twice.
  if (kind === "unclassified" && isInternal && ccdOnly) {
    kind = "staff_supplier_request";
  }

  // client_forward: internal staff forwarding a client request in.
  if (kind === "unclassified" && isInternal) {
    kind = "client_forward";
  }

  const { error } = await service.from("inbound_emails").insert({
    message_id: messageId,
    in_reply_to: inReplyTo,
    from_email: fromEmail,
    to_email: toEmail,
    header_to: headerTo,
    header_cc: headerCc,
    subject,
    text_body: full.text ?? null,
    html_body: full.html ?? null,
    attachments: full.attachments ?? [],
    kind,
    rfq_id: rfqId,
    quote_id: quoteId,
    resend_email_id: emailId,
  });
  if (error) {
    console.error("failed to store inbound email:", error.message);
    return NextResponse.json({ error: "store failed" }, { status: 500 });
  }

  if (rfqId) {
    await service.from("rfq_events").insert({
      rfq_id: rfqId,
      kind: "email_received",
      body: `Reply from ${fromEmail}: "${subject}"`,
    });
  }

  // Processing is manual now (the scheduled run was retired) — tell Shawn
  // something arrived. Fail-soft: notification trouble never fails the hook.
  await notifyInboundRfqEmail({
    kind,
    fromEmail,
    subject,
    textBody: full.text ?? null,
    rfqId,
    quoteId,
  });

  return NextResponse.json({ ok: true, kind });
}
