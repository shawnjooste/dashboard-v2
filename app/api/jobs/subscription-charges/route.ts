import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runSubscriptionCharge, type RunResult } from "@/lib/subscriptions/run-charge";

/**
 * Daily recurring-billing sweep (Vercel Cron, 06:15 SAST). Runs daily — not
 * just on the 1st — because retries land on days 3 and 5 of a period.
 *
 * Idempotent by construction: the partial unique index (one SUCCESS per
 * subscription+period) plus the retry-spacing check in decideCharge mean a
 * duplicate invocation charges nothing and creates nothing.
 *
 * Guarded by the same `Authorization: Bearer <CRON_SECRET>` header as the
 * other job routes; GET (Vercel Cron) and POST (manual) share one handler.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: due } = await service
    .from("quote_subscriptions")
    .select("id")
    .eq("status", "active")
    .lte("next_charge_date", today);

  const counts: Record<RunResult, number> = {
    charged: 0, retry_failed: 0, exhausted: 0, advanced: 0, waiting: 0, skipped: 0,
  };
  for (const sub of due ?? []) {
    try {
      counts[await runSubscriptionCharge(sub.id)] += 1;
    } catch (e) {
      console.error("subscription charge run failed:", sub.id, e);
      counts.skipped += 1;
    }
  }
  return NextResponse.json({ due: due?.length ?? 0, ...counts });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
