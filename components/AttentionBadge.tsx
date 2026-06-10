export function AttentionBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
      }`}
    >
      {ok ? "Healthy" : "Needs attention"}
    </span>
  );
}
