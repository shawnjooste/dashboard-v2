export function Sparkline({ values, width = 120, height = 28 }: { values: number[]; width?: number; height?: number }) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return <span className="text-xs text-gray-400">not enough history</span>;
  const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
  const step = width / (pts.length - 1);
  const d = pts
    .map((v, i) => `${i === 0 ? "M" : "L"} ${i * step} ${height - ((v - min) / range) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="text-blue-500">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
