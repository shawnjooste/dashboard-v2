"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-runs the page's server components on an interval, so a tab left open on
 * a live status page keeps up with the 5-minute pull instead of freezing at
 * whatever it rendered — including the "checked N ago" label, which is
 * computed server-side and would otherwise never tick over.
 *
 * Skips work while the tab is hidden, and refreshes immediately when it comes
 * back into view, so returning to an old tab shows current data at once.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(refreshIfVisible, Math.max(15, seconds) * 1000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router, seconds]);

  return null;
}
