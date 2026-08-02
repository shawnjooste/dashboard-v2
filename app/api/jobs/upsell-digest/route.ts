import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listConversationsSince } from "@/lib/freescout";
import { clientIdForEmail, type DomainRow } from "@/lib/ticket-client-map";
import { heavyFreeUsers, HEAVY_USER_THRESHOLD } from "@/lib/upsell";
import { sendJobDigest } from "@/lib/job-emails";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";
const LEADS_TO = "shawn@rocking.one";

/**
 * Monthly "who's outgrowing free support" digest.
 *
 * We deliberately never cap free tickets — email stays open regardless, so a
 * cap would only push traffic out of the portal and punish people mid-crisis.
 * The commercial answer instead: volume becomes a lead. This lists free-tier
 * clients over the threshold so someone can actually make the call.
 *
 * Guarded by CRON_SECRET like the other jobs; `?dry=1` previews without
 * sending. Sends nothing when there are no leads.
 */
async function runUpsellDigest(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET not set — refusing to run the upsell digest");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  // Calendar month to date.
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  let tickets;
  try {
    tickets = await listConversationsSince(since);
  } catch (e) {
    console.error("upsell digest: helpdesk unreachable", e);
    return NextResponse.json({ error: "helpdesk unreachable" }, { status: 502 });
  }

  const service = createServiceClient();
  const [{ data: domains }, { data: clients }, { data: packages }] = await Promise.all([
    service.from("client_domains").select("client_id, domain"),
    service.from("clients").select("id, name, support_package_id"),
    service.from("support_packages").select("id, is_default"),
  ]);

  const defaultPkgId = (packages ?? []).find((p) => p.is_default)?.id ?? null;
  const byId = new Map((clients ?? []).map((c) => [c.id, c]));

  const counts = new Map<string, number>();
  for (const t of tickets) {
    const cid = clientIdForEmail(t.customerEmail, (domains ?? []) as DomainRow[]);
    if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }

  const rows = [...counts.entries()].map(([cid, n]) => {
    const c = byId.get(cid);
    const pkgId = c?.support_package_id ?? defaultPkgId;
    return {
      clientName: c?.name ?? null,
      onPaidTier: !!pkgId && pkgId !== defaultPkgId,
      tickets: n,
    };
  });

  const leads = heavyFreeUsers(rows);
  const month = since.slice(0, 7);

  if (dry) {
    return NextResponse.json({ dryRun: true, month, threshold: HEAVY_USER_THRESHOLD, leads });
  }
  if (leads.length === 0) {
    return NextResponse.json({ month, leads: 0, sent: 0 });
  }

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#1a1a1a;">
      <h2 style="margin:0 0 8px;">Free clients leaning on support — ${month}</h2>
      <p style="color:#444;margin:0 0 14px;">
        These clients are on Standard (free) support and raised ${HEAVY_USER_THRESHOLD}+ tickets this month.
        They're getting real value — worth a conversation about Business Care.
      </p>
      <ul style="padding-left:18px;margin:0 0 16px;">
        ${leads.map((l) => `<li style="margin:0 0 6px;"><strong>${l.clientName}</strong> — ${l.tickets} tickets</li>`).join("")}
      </ul>
      <a href="${APP_URL}/admin/support-packages/assign" style="display:inline-block;background:#D7141C;color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:8px;">Assign tiers</a>
    </div>`;

  try {
    await sendJobDigest(LEADS_TO, `${leads.length} free client${leads.length === 1 ? "" : "s"} worth a call — ${month}`, html);
  } catch (e) {
    console.error("upsell digest send failed", e);
    return NextResponse.json({ month, leads: leads.length, sent: 0 }, { status: 502 });
  }
  return NextResponse.json({ month, leads: leads.length, sent: 1 });
}

export const GET = runUpsellDigest;
export const POST = runUpsellDigest;
