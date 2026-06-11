import { StatusBadge } from "./ui/status";

export function AttentionBadge({ ok }: { ok: boolean }) {
  return <StatusBadge tone={ok ? "good" : "bad"} label={ok ? "Healthy" : "Needs attention"} />;
}
