"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui";
import { chargeSubscriptionNow, stopSubscription } from "../actions";

export type SubCardCharge = {
  period: string;      // "2026-09"
  attempt: number;
  amount: string;      // formatted incl VAT
  status: "pending" | "success" | "failed";
  failureReason: string | null;
  at: string;          // yyyy-mm-dd
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-good-tint text-good",
  pending_payment: "bg-line-soft text-ink-3",
  failed: "bg-warn-tint-2 text-warn-ink",
  cancelled: "bg-line-soft text-muted",
};

/** Recurring-billing control for a checkout quote: status, history, stop,
 *  and a manual charge trigger sharing the cron's exact code path. */
export function SubscriptionCard({
  quoteId,
  status,
  monthlyIncl,
  nextChargeDate,
  charges,
}: {
  quoteId: string;
  status: "pending_payment" | "active" | "cancelled" | "failed";
  monthlyIncl: string;
  nextChargeDate: string | null;
  charges: SubCardCharge[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const stop = () => {
    setError(null);
    start(async () => {
      const res = await stopSubscription(quoteId);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  const chargeNow = () => {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await chargeSubscriptionNow(quoteId);
      if (res.ok) {
        setNotice(`Charge run: ${res.result.replace("_", " ")}`);
        router.refresh();
      } else setError(res.error);
    });
  };

  const stoppable = status === "active" || status === "failed";

  return (
    <Card>
      <CardHeader title="Recurring billing" />
      <div className="space-y-3 px-4 py-3.5">
        <div className="flex items-center justify-between text-sm">
          <span
            className={`rounded-full px-[9px] py-1 text-[11.5px] font-semibold ${STATUS_STYLE[status]}`}
          >
            {status.replace("_", " ")}
          </span>
          <span className="font-semibold text-ink">{monthlyIncl} / month</span>
        </div>
        {nextChargeDate && status === "active" && (
          <p className="text-xs text-muted">Next charge: {nextChargeDate}</p>
        )}

        {error && (
          <p className="rounded-md bg-brand-tint px-2.5 py-1.5 text-xs font-medium text-[#B01218]">{error}</p>
        )}
        {notice && (
          <p className="rounded-md bg-good-tint px-2.5 py-1.5 text-xs font-medium text-good">{notice}</p>
        )}

        {stoppable && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={chargeNow}
              className="flex-1 rounded-md bg-ink px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
            >
              {pending ? "Working…" : "Charge now"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={stop}
              className="flex-1 rounded-md border border-line px-3 py-2 text-[13px] font-semibold text-brand transition-colors hover:bg-brand-tint disabled:opacity-60"
            >
              Stop billing
            </button>
          </div>
        )}

        {charges.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-[0.5px] text-faint">
                  <th className="py-1 pr-2 font-semibold">Period</th>
                  <th className="py-1 pr-2 font-semibold">Try</th>
                  <th className="py-1 pr-2 text-right font-semibold">Amount</th>
                  <th className="py-1 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c, i) => (
                  <tr key={i} className="border-t border-line-soft align-top">
                    <td className="py-1.5 pr-2 whitespace-nowrap text-ink-2">{c.period}</td>
                    <td className="py-1.5 pr-2 text-ink-3">{c.attempt}</td>
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap text-ink-2">{c.amount}</td>
                    <td className="py-1.5">
                      <span
                        className={
                          c.status === "success"
                            ? "font-semibold text-good"
                            : c.status === "failed"
                              ? "font-semibold text-brand"
                              : "text-muted"
                        }
                      >
                        {c.status}
                      </span>
                      {c.failureReason && (
                        <span className="block text-[11px] text-faint">{c.failureReason}</span>
                      )}
                      <span className="block text-[10.5px] text-faint">{c.at}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
