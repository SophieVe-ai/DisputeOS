// Animated topology: each agent fires a write into AuditLog.sol in turn, which
// mines onto a conveyor of blocks. Pure SVG/SMIL + CSS — no JS animation loop.
import { IconChallenge, IconEvidence, IconGate, IconReconcile, IconResolution } from "./ui/icons";

const CYCLE_S = 7.5;
const NODE_Y = 78;
const CONTRACT_Y = 226;
const CHAIN_Y = 304;
const BLOCK_PITCH = 64;
const NODES = [
  { x: 66, label: "Evidence", Icon: IconEvidence },
  { x: 183, label: "Reconcile", Icon: IconReconcile },
  { x: 300, label: "Challenge", Icon: IconChallenge },
  { x: 417, label: "Resolve", Icon: IconResolution },
  { x: 534, label: "Approve", Icon: IconGate, human: true },
];
// Decorative conveyor: blank blocks only. Real block numbers live in the on-chain log.
const BLOCKS = Array.from({ length: 12 }, (_, i) => ({ x: i * BLOCK_PITCH - 40 }));

const slot = (i: number) => {
  const a = i / NODES.length;
  return { a, b: a + 0.12 };
};

export function HeroGraph() {
  return (
    <svg viewBox="0 0 600 360" className="h-auto w-full" role="img" aria-label="Five-stage agent pipeline writing every action to an on-chain audit log">
      <defs>
        <linearGradient id="fade-x" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".18" stopColor="#fff" />
          <stop offset=".82" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="fade-mask"><rect width="600" height="360" fill="url(#fade-x)" /></mask>
        <radialGradient id="packet-glow">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Pipeline rail */}
      <line x1={NODES[0].x} x2={NODES[4].x} y1={NODE_Y} y2={NODE_Y} stroke="var(--border-2)" />
      <line x1={NODES[0].x} x2={NODES[4].x} y1={NODE_Y} y2={NODE_Y} stroke="var(--ink-3)" className="flow" />
      <g>
        <circle r="10" fill="url(#packet-glow)" />
        <circle r="2.2" fill="#fff" />
        <animateMotion dur={`${CYCLE_S}s`} repeatCount="indefinite" path={`M${NODES[0].x} ${NODE_Y} H${NODES[4].x}`} />
      </g>

      {/* Writes: each node → contract */}
      {NODES.map((n, i) => {
        const d = `M${n.x} ${NODE_Y + 24} C${n.x} ${NODE_Y + 96}, 300 ${CONTRACT_Y - 80}, 300 ${CONTRACT_Y - 17}`;
        const { a, b } = slot(i);
        return (
          <g key={n.label}>
            <path d={d} stroke="var(--border)" fill="none" />
            <path d={d} stroke="var(--border-2)" fill="none" className="flow" />
            <g opacity="0">
              <circle r="8" fill="url(#packet-glow)" />
              <circle r="2" fill="#fff" />
              <animateMotion dur={`${CYCLE_S}s`} repeatCount="indefinite" path={d} keyPoints="0;0;1;1" keyTimes={`0;${a};${b};1`} calcMode="linear" />
              <animate attributeName="opacity" dur={`${CYCLE_S}s`} repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes={`0;${a};${a + 0.01};${b - 0.01};${b};1`} />
            </g>
          </g>
        );
      })}

      {/* Agent nodes */}
      {NODES.map((n, i) => (
        <g key={n.label} transform={`translate(${n.x} ${NODE_Y})`}>
          <circle r="31" fill="none" stroke="var(--ink-3)" strokeOpacity=".45" strokeDasharray="1 5" className="spin-slow" />
          <circle r="22" fill="var(--panel-2)" stroke={n.human ? "rgba(242,179,61,.45)" : "var(--border-2)"} />
          <circle r="22" fill="none" stroke={n.human ? "var(--warn)" : "#fff"} strokeWidth="1.2" className="node-glow" style={{ animationDelay: `${(i * CYCLE_S) / NODES.length}s` }} />
          <n.Icon x={-9} y={-9} size={18} className={n.human ? "text-warn" : "text-ink"} />
          <text y="-38" textAnchor="middle" className="fill-ink-3 font-mono" fontSize="8.5" letterSpacing="1.2">{String(i + 1).padStart(2, "0")}</text>
          <text y="44" textAnchor="middle" className="fill-ink-2 font-mono uppercase" fontSize="8.5" letterSpacing="1.4">{n.label}</text>
        </g>
      ))}

      {/* Contract */}
      <g transform={`translate(300 ${CONTRACT_Y})`}>
        <circle r="16" fill="none" stroke="#fff" strokeOpacity=".6" className="ping" style={{ animationDuration: `${CYCLE_S / NODES.length}s`, animationDelay: `${CYCLE_S * 0.12}s` }} />
        <rect x="-78" y="-17" width="156" height="34" rx="4" fill="var(--panel)" stroke="var(--border-2)" />
        <text y="-2" textAnchor="middle" className="fill-ink font-mono" fontSize="10">AuditLog.sol</text>
        <text y="10" textAnchor="middle" className="fill-ink-3 font-mono" fontSize="7.5" letterSpacing=".8">append(entryHash, prevHash)</text>
      </g>
      <line x1="300" x2="300" y1={CONTRACT_Y + 17} y2={CHAIN_Y - 14} stroke="var(--ink-3)" className="flow" />

      {/* Block conveyor */}
      <g mask="url(#fade-mask)">
        <g className="conveyor">
          {BLOCKS.map((blk, i) => (
            <g key={i} transform={`translate(${blk.x} ${CHAIN_Y})`}>
              {i < BLOCKS.length - 1 && <line x1="44" x2={BLOCK_PITCH} y1="13" y2="13" stroke="var(--border-2)" />}
              <rect width="44" height="26" rx="3" fill="var(--panel-2)" stroke="var(--border-2)" />
              <line x1="9" x2="35" y1="10" y2="10" stroke="var(--ink-3)" strokeOpacity=".5" />
              <line x1="9" x2="27" y1="16" y2="16" stroke="var(--ink-3)" strokeOpacity=".5" />
            </g>
          ))}
        </g>
      </g>
      <text x="300" y={CHAIN_Y + 46} textAnchor="middle" className="fill-ink-3 font-mono uppercase" fontSize="8" letterSpacing="1.6">
        append-only · hash-chained · no edit or delete
      </text>
    </svg>
  );
}
