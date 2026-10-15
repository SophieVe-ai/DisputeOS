/** Score history as a drawn polyline (0–100% on the y axis). */
export function Sparkline({ values, width = 260, height = 56 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <p className="font-mono text-[10.5px] text-ink-3">Run the eval again to build a trend.</p>;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 8) + 4, height - 4 - (v / 100) * (height - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const len = Math.ceil(pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0));
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Score history: ${values.join(", ")}%`}>
      <line x1="0" x2={width} y1={height - 4 - 0.9 * (height - 8)} y2={height - 4 - 0.9 * (height - 8)} stroke="var(--border-2)" strokeDasharray="2 4" />
      <path key={values.join(",")} d={d} fill="none" stroke="var(--ink)" strokeWidth="1.5" className="draw" style={{ ["--len" as string]: len }} />
      <circle cx={lx} cy={ly} r="3" fill="var(--good)" />
      <circle cx={lx} cy={ly} r="3" fill="var(--good)" className="ping" />
    </svg>
  );
}
