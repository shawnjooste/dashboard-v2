export function Sparkline({
  values,
  width = 120,
  height = 28,
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  fill?: boolean;
}) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return <span className="text-xs text-faint">not enough history</span>;
  const min = Math.min(...pts),
    max = Math.max(...pts),
    range = max - min || 1;
  const step = width / (pts.length - 1);
  const coords = pts.map((v, i) => [i * step, height - 2 - ((v - min) / range) * (height - 4)] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block">
      {fill && <path d={area} fill="var(--color-brand-tint)" />}
      <path d={line} fill="none" stroke="var(--color-brand)" strokeWidth="1.5" />
    </svg>
  );
}
