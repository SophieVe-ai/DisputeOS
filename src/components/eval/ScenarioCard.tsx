import type { ScenarioResult } from "@/lib/eval/harness";
import { IconCheck, IconX } from "../ui/icons";
import { Gauge } from "./Gauge";

function Bar({ value }: { value: number }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-line-2">
      <span className={`block h-full origin-left ${value >= 1 ? "bg-good" : value >= 0.6 ? "bg-warn" : "bg-bad"}`} style={{ transform: `scaleX(${value})`, transition: "transform 1s cubic-bezier(.16,1,.3,1)" }} />
    </span>
  );
}

export function ScenarioCard({ s, index }: { s: ScenarioResult; index: number }) {
  const passed = s.checks.filter((c) => c.score === 1).length;
  return (
    <article className="card frame reveal p-5" style={{ animationDelay: `${index * 90}ms` }}>
      <header className="flex items-start gap-4">
        <Gauge value={s.score} size={96} label="score" tone={s.score >= 90 ? "var(--good)" : s.score >= 70 ? "var(--warn)" : "var(--bad)"} />
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{s.source === "upload" ? "upload path" : "case file"}</span>
            {s.status === "failed" && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-bad">failed</span>}
          </div>
          <h3 className="mt-1 text-[14px] font-medium">{s.name}</h3>
          <p className="mt-1 text-[12px] leading-snug text-ink-3">{s.tests}</p>
          <div className="mt-3 flex gap-5 font-mono text-[10.5px] text-ink-2">
            <span>opt <span className="text-ink">{s.optimisation}%</span></span>
            <span>eff <span className="text-ink">{s.efficiency}%</span></span>
            <span>{passed}/{s.checks.length} checks</span>
            <span>{s.durationMs} ms</span>
          </div>
        </div>
      </header>
      {s.error && <p className="mt-4 text-[12px] text-bad">{s.error}</p>}
      {s.checks.length > 0 && (
        <table className="mt-5 w-full text-[11.5px]">
          <thead>
            <tr className="text-left">
              {["", "Check", "Expected", "Actual"].map((h) => <th key={h} className="label pb-2 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {s.checks.map((c) => (
              <tr key={c.name} className="border-t border-line align-top">
                <td className="py-1.5 pr-2">{c.score === 1 ? <IconCheck size={13} className="text-good" /> : <IconX size={13} className="text-bad" />}</td>
                <td className="py-1.5 pr-3 text-ink-2">{c.name}<span className="ml-1 font-mono text-[10px] text-ink-3">×{c.weight}</span></td>
                <td className="py-1.5 pr-3 font-mono text-ink-3">{c.expected}</td>
                <td className={`py-1.5 font-mono ${c.score === 1 ? "text-ink-2" : "text-bad"}`}>{c.actual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.metrics.length > 0 && (
        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-line pt-4">
          {s.metrics.map((m) => (
            <div key={m.name}>
              <dt className="flex justify-between font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3"><span>{m.name}</span><span className="text-ink-2">{Math.round(m.score * 100)}%</span></dt>
              <dd className="mt-1.5"><Bar value={m.score} /></dd>
              <dd className="mt-1 font-mono text-[10px] text-ink-3">{m.value} · budget {m.budget}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
