"use client";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { api, usePoll } from "@/components/api";
import { Gauge } from "@/components/eval/Gauge";
import { ScenarioCard } from "@/components/eval/ScenarioCard";
import { Sparkline } from "@/components/eval/Sparkline";
import { IconChain, IconScan } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/motion";
import type { EvalState } from "@/lib/eval/service";

const IDLE_POLL_MS = 5000;
const RUNNING_POLL_MS = 800;

const METHOD = [
  { k: "Optimisation · 70%", v: "Did the agents reach the legally correct outcome? Principal, days overdue, deductions, verdicts on each debtor argument, the recommended strategy and the drafted actions are compared with hand-derived answers. Money accuracy is continuous; everything else is pass or fail, weighted by importance." },
  { k: "Efficiency · 30%", v: "How cheaply did they get there? Pipeline latency against a per-engine budget, first-attempt success (no retries), model fallbacks, and ledger writes against a proportionate budget." },
  { k: "Isolation", v: "Every scenario runs end-to-end in its own in-memory database and in-memory chain, in a separate process. Running an eval never touches live cases." },
];

export default function EvalsPage() {
  const [pollMs, setPollMs] = useState(IDLE_POLL_MS);
  const { data, refresh } = usePoll<EvalState>("/api/evals", pollMs);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = starting || Boolean(data?.running);
  if (data && !data.running && pollMs !== IDLE_POLL_MS && !starting) setPollMs(IDLE_POLL_MS);

  const report = data?.latest?.report ?? null;

  async function run() {
    setStarting(true);
    setError(null);
    try {
      const requestedBy = localStorage.getItem("disputeos.approver") || "operator";
      await api("/api/evals", { method: "POST", body: JSON.stringify({ requestedBy }) });
      setPollMs(RUNNING_POLL_MS);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-12">
      <section className="relative left-1/2 -mt-10 w-screen -translate-x-1/2 overflow-hidden border-b border-line">
        <div aria-hidden className="absolute inset-0">
          <Image src="/images/eval-dial.jpg" alt="" fill priority sizes="100vw" className="kenburns object-cover object-[70%_40%] opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/50" />
        </div>
        <div className="relative mx-auto grid max-w-[1400px] items-center gap-10 px-6 py-20 lg:grid-cols-[1fr_auto]">
          <div>
            <Reveal><span className="label">Agent evaluation</span></Reveal>
            <Reveal delay={80}><h1 className="mt-4 text-[44px] font-normal leading-[1.03] tracking-[-0.04em] md:text-[60px]">Measured, not asserted.</h1></Reveal>
            <Reveal delay={160}>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-2">
                {report?.total ?? 5} gold-labelled disputes, including one built from raw uploaded files, run through the full agent pipeline.
                One score for getting the answer right and doing it efficiently. Every result is anchored on-chain.
              </p>
            </Reveal>
            <Reveal delay={240} className="mt-8 flex flex-wrap items-center gap-4">
              <button type="button" className="btn btn-primary h-10 px-5" disabled={running} onClick={run}>
                {running ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" className="spin" aria-hidden><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.5" /><path d="M6 1a5 5 0 0 1 5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
                ) : <IconScan size={14} />}
                {running ? "Running scenarios in a sandbox…" : report ? "Run the eval again" : "Run the eval"}
              </button>
              {report && (
                <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                  {report.engine}{report.model ? ` · ${report.model}` : ""} · {report.durationMs} ms · {new Date(report.startedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </Reveal>
            {(error || data?.error) && <p role="alert" className="mt-4 text-[13px] text-bad">{error ?? data?.error}</p>}
          </div>
          <Reveal delay={200} className={`relative ${running ? "opacity-60" : ""} transition-opacity`}>
            {running && <div aria-hidden className="scanner rounded-full" />}
            <Gauge value={report?.score ?? null} size={280} label="Overall" sublabel={report ? `${report.checksPassed}/${report.checksTotal} checks` : "not yet run"} />
          </Reveal>
        </div>
      </section>

      {report && (
        <section className="grid gap-6 lg:grid-cols-[auto_auto_1fr]">
          <Reveal className="card frame flex justify-center p-6"><Gauge value={report.optimisation} size={170} label="Optimisation" sublabel="weight 70%" tone="var(--ink)" /></Reveal>
          <Reveal delay={80} className="card frame flex justify-center p-6"><Gauge value={report.efficiency} size={170} label="Efficiency" sublabel="weight 30%" tone="var(--info)" /></Reveal>
          <Reveal delay={160} className="card frame flex flex-col justify-between gap-6 p-6">
            <div>
              <div className="label">Score history</div>
              <div className="mt-4"><Sparkline values={data?.history.map((h) => h.score) ?? []} /></div>
            </div>
            {data?.latest && (
              <Link href="/ledger" className="group flex items-center gap-3 rounded border border-line bg-panel-2 px-4 py-3 transition-colors hover:border-line-2">
                <IconChain size={15} className="text-good" />
                <span className="text-[13px] text-ink-2">Result anchored as ledger entry <span className="font-mono text-ink">#{data.latest.ledgerSeq}</span> · <span className="font-mono">eval.completed</span></span>
                <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3 group-hover:text-ink">view</span>
              </Link>
            )}
          </Reveal>
        </section>
      )}

      {report && (
        <section>
          <div className="mb-5 flex items-baseline justify-between border-b border-line pb-4">
            <h2 className="text-[22px] font-normal tracking-[-0.02em]">Scenarios</h2>
            <span className="font-mono text-[10.5px] text-ink-3">{report.passed}/{report.total} perfect</span>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            {report.scenarios.map((s, i) => <ScenarioCard key={`${report.startedAt}-${s.id}`} s={s} index={i} />)}
          </div>
        </section>
      )}

      <section>
        <div className="mb-5 border-b border-line pb-4"><h2 className="text-[22px] font-normal tracking-[-0.02em]">Method</h2></div>
        <dl className="grid gap-4 md:grid-cols-3">
          {METHOD.map((m, i) => (
            <Reveal key={m.k} delay={i * 80} className="card frame p-5">
              <dt className="label">{m.k}</dt>
              <dd className="mt-3 text-[13px] leading-relaxed text-ink-2">{m.v}</dd>
            </Reveal>
          ))}
        </dl>
        <p className="mt-4 font-mono text-[11px] text-ink-3">Run it from the terminal too: <span className="text-ink-2">npm run eval</span> · add <span className="text-ink-2">-- --min 90</span> to gate CI.</p>
      </section>
    </div>
  );
}
