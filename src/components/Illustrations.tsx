// Looping SVG illustrations for the "How it works" section. Pure SVG + CSS keyframes.
const W = 240;
const H = 150;

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      <defs>
        <linearGradient id="scan-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#7ea6ff" stopOpacity="0" />
          <stop offset="1" stopColor="#7ea6ff" stopOpacity=".55" />
        </linearGradient>
      </defs>
      {children}
    </svg>
  );
}

/** A document being read: scan beam sweeps, extracted facts pop out as tags. */
export function IllusIngest() {
  return (
    <Frame label="Documents are scanned and facts extracted">
      <g transform="translate(46 18)">
        <rect x="10" y="8" width="74" height="100" rx="3" fill="var(--panel-2)" stroke="var(--border)" />
        <rect width="74" height="100" rx="3" fill="var(--panel-2)" stroke="var(--border-2)" />
        <path d="M54 0v16h20" fill="none" stroke="var(--border-2)" />
        {[24, 34, 44, 54, 64, 74, 84].map((y, i) => (
          <line key={y} x1="10" x2={i % 3 === 2 ? 40 : 62} y1={y} y2={y} stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" opacity=".55" />
        ))}
        <g className="scan-y" style={{ ["--scan-distance" as string]: "84px" }}>
          <rect x="-4" y="-2" width="82" height="16" fill="url(#scan-grad)" />
          <line x1="-4" x2="78" y1="14" y2="14" stroke="#7ea6ff" />
        </g>
      </g>
      {[
        { x: 132, y: 34, t: "DOCUMENT TYPE", d: "0s" },
        { x: 140, y: 62, t: "AMOUNT", d: ".9s" },
        { x: 132, y: 90, t: "DUE DATE", d: "1.8s" },
      ].map((tag) => (
        <g key={tag.t} className="pop-tag" style={{ animationDelay: tag.d }}>
          <line x1="120" x2={tag.x} y1={tag.y + 7} y2={tag.y + 7} stroke="var(--border-2)" />
          <rect x={tag.x} y={tag.y} width={tag.t.length * 6.2 + 12} height="15" rx="2" fill="var(--panel)" stroke="var(--border-2)" />
          <text x={tag.x + 6} y={tag.y + 10.5} className="fill-ink-2 font-mono" fontSize="7.5" letterSpacing=".6">{tag.t}</text>
        </g>
      ))}
    </Frame>
  );
}

/** Each line item: what we invoiced vs what the evidence supports. Matches tick; a gap is deducted. */
export function IllusReconcile() {
  const X0 = 58;
  const rows = [
    { y: 22, label: "ITEM A", invoiced: 128, evidenced: 128 },
    { y: 58, label: "ITEM B", invoiced: 128, evidenced: 92 },
    { y: 94, label: "ITEM C", invoiced: 96, evidenced: 96 },
  ];
  return (
    <Frame label="Each invoiced line is checked against the evidence; unsupported amounts are deducted">
      {rows.map((r, i) => {
        const gap = r.invoiced - r.evidenced;
        const delay = (n: number) => ({ animationDelay: `${i * 0.18 + n}s` });
        return (
          <g key={r.label}>
            <text x="14" y={r.y + 11} className="fill-ink-3 font-mono" fontSize="7" letterSpacing=".8">{r.label}</text>
            <rect x={X0} y={r.y} width={r.invoiced} height="6" rx="1" fill="var(--border-2)" className="grow-x" style={delay(0)} />
            <rect x={X0} y={r.y + 10} width={r.evidenced} height="6" rx="1" fill="var(--ink)" className="grow-x" style={delay(0.45)} />
            {gap > 0 && (
              <g className="settle" style={delay(0)}>
                <rect x={X0 + r.evidenced} y={r.y + 10} width={gap} height="6" rx="1" fill="rgba(242,179,61,.18)" stroke="var(--warn)" strokeDasharray="2 2" />
                <text x={X0 + r.evidenced + gap / 2} y={r.y + 27} textAnchor="middle" className="fill-warn font-mono" fontSize="6.5" letterSpacing=".6">DEDUCTED</text>
              </g>
            )}
            {/* Position on the outer group: the animated transform on the inner one would override it. */}
            <g transform={`translate(204 ${r.y + 8})`}>
              <g className="settle" style={delay(0)}>
                {gap > 0 ? (
                  <><circle r="7" fill="none" stroke="var(--warn)" /><path d="M0-3.5v4M0 2.6v.4" stroke="var(--warn)" strokeWidth="1.5" strokeLinecap="round" /></>
                ) : (
                  <><circle r="7" fill="none" stroke="var(--good)" /><path d="M-3 0.3l2 2 4-4.3" fill="none" stroke="var(--good)" strokeWidth="1.5" /></>
                )}
              </g>
            </g>
          </g>
        );
      })}
      <g transform="translate(14 136)" className="font-mono" fontSize="6.5" letterSpacing=".8">
        <rect width="8" height="5" y="-4.5" fill="var(--border-2)" />
        <text x="12" className="fill-ink-3">INVOICED</text>
        <rect x="66" width="8" height="5" y="-4.5" fill="var(--ink)" />
        <text x="78" className="fill-ink-3">EVIDENCED</text>
        <rect x="136" width="8" height="5" y="-4.5" fill="rgba(242,179,61,.18)" stroke="var(--warn)" strokeDasharray="2 2" strokeWidth=".7" />
        <text x="148" className="fill-ink-3">DEDUCTED</text>
      </g>
    </Frame>
  );
}

/** Claim and defence trade arguments; a verdict is drawn. */
export function IllusChallenge() {
  const arc = "M62 75 C 100 30, 140 30, 178 75";
  const back = "M178 75 C 140 120, 100 120, 62 75";
  return (
    <Frame label="An adversarial agent argues the debtor's side">
      <path d={arc} fill="none" stroke="var(--border-2)" className="flow" />
      <path d={back} fill="none" stroke="var(--border-2)" className="flow" />
      {[{ d: arc, begin: "0s" }, { d: back, begin: "1.2s" }].map((p) => (
        <circle key={p.begin} r="2.5" fill="#fff">
          <animateMotion dur="2.4s" begin={p.begin} repeatCount="indefinite" path={p.d} keyPoints="0;1;1" keyTimes="0;.5;1" calcMode="linear" />
        </circle>
      ))}
      <g transform="translate(62 75)">
        <circle r="20" fill="var(--panel-2)" stroke="var(--border-2)" />
        <text y="3" textAnchor="middle" className="fill-ink font-mono" fontSize="8" letterSpacing="1">CLAIM</text>
      </g>
      <g transform="translate(178 75)">
        <circle r="20" fill="var(--panel-2)" stroke="rgba(255,90,82,.4)" />
        <text y="3" textAnchor="middle" className="fill-bad font-mono" fontSize="7.5" letterSpacing="1">DEBTOR</text>
      </g>
      <g transform="translate(120 75)">
        <circle r="11" fill="var(--bg)" stroke="var(--good)" strokeOpacity=".6" />
        <path d="M-5 0.5l3.5 3.5L5.5-4" fill="none" stroke="var(--good)" strokeWidth="1.6" className="draw-loop" style={{ ["--len" as string]: 18 }} />
      </g>
      <text x="120" y="136" textAnchor="middle" className="fill-ink-3 font-mono" fontSize="7" letterSpacing="1">UPHELD · REBUTTED · DEDUCTED</text>
    </Frame>
  );
}

/** A new block drops onto the chain and links to its predecessor. */
export function IllusAnchor() {
  const blocks = [24, 76, 128];
  return (
    <Frame label="Every action is anchored to an append-only chain">
      {blocks.map((x, i) => (
        <g key={x} transform={`translate(${x} 62)`}>
          <rect width="40" height="34" rx="3" fill="var(--panel-2)" stroke="var(--border-2)" />
          <line x1="9" x2="31" y1="13" y2="13" stroke="var(--ink-3)" strokeOpacity={0.6 - i * 0.1} />
          <line x1="9" x2="24" y1="21" y2="21" stroke="var(--ink-3)" strokeOpacity={0.6 - i * 0.1} />
          <line x1="40" x2="52" y1="17" y2="17" stroke="var(--border-2)" />
        </g>
      ))}
      <g transform="translate(180 62)">
        <g className="drop-block">
          <rect width="40" height="34" rx="3" fill="var(--panel)" stroke="var(--good)" />
          <text x="20" y="21" textAnchor="middle" className="fill-good font-mono" fontSize="7" letterSpacing="1">NEW</text>
        </g>
      </g>
      <line x1="168" x2="180" y1="79" y2="79" stroke="var(--good)" className="draw-loop" style={{ ["--len" as string]: 12 }} />
      <text x="120" y="126" textAnchor="middle" className="fill-ink-3 font-mono" fontSize="7" letterSpacing="1">PREV-HASH LINKED · NO EDIT · NO DELETE</text>
    </Frame>
  );
}
