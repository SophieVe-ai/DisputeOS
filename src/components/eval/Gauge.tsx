"use client";
import { CountUp } from "../ui/motion";

const TICKS = 60;
// Server and browser trig differ in the last bits; round so hydration matches.
const px = (n: number) => Math.round(n * 100) / 100;
/** Below this size there is no room for the caption inside the ring. */
const COMPACT_SIZE = 140;

/** Radial score gauge: a machined tick ring with an arc that sweeps to the score. */
export function Gauge({ value, size = 220, label, sublabel, tone = "var(--good)" }: { value: number | null; size?: number; label: string; sublabel?: string; tone?: string }) {
  const r = size / 2 - 18;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  const compact = size < COMPACT_SIZE;
  return (
    <figure className="relative flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {Array.from({ length: TICKS }, (_, i) => {
          const a = (i / TICKS) * 2 * Math.PI - Math.PI / 2;
          const major = i % 5 === 0;
          const r1 = r + 8;
          const r2 = r + (major ? 15 : 12);
          const lit = value !== null && i / TICKS <= v / 100;
          return <line key={i} x1={px(c + r1 * Math.cos(a))} y1={px(c + r1 * Math.sin(a))} x2={px(c + r2 * Math.cos(a))} y2={px(c + r2 * Math.sin(a))} stroke={lit ? tone : "var(--border-2)"} strokeOpacity={lit ? 0.9 : 1} strokeWidth={major ? 1.5 : 1} style={{ transition: `stroke .4s ${i * 12}ms` }} />;
        })}
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        {value !== null && (
          <circle
            key={value}
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - v / 100)}
            transform={`rotate(-90 ${c} ${c})`}
            className="gauge-fill"
            style={{ ["--circ" as string]: circ, filter: `drop-shadow(0 0 6px ${tone})` }}
          />
        )}
        <circle cx={c} cy={c} r={r - 14} fill="none" stroke="var(--border)" strokeDasharray="1 4" className="spin-slow" />
      </svg>
      <figcaption className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-light tabular-nums tracking-[-0.04em]" style={{ fontSize: size * (compact ? 0.17 : 0.2) }}>
          <CountUp value={value} format={(n) => (compact ? String(Math.round(n)) : n.toFixed(1))} fallback="—" />
          <span className="text-ink-3" style={{ fontSize: size * 0.09 }}>%</span>
        </span>
        {compact ? <span className="sr-only">{label}</span> : <span className="label mt-1">{label}</span>}
        {sublabel && !compact && <span className="mt-1 font-mono text-[10px] text-ink-3">{sublabel}</span>}
      </figcaption>
    </figure>
  );
}
