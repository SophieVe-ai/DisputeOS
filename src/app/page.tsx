"use client";
import Link from "next/link";
import { usePoll } from "@/components/api";
import { ChainConsole } from "@/components/ChainConsole";
import { money, pct } from "@/components/format";
import { HeroGraph } from "@/components/HeroGraph";
import { StatusBadge } from "@/components/StatusBadge";
import type { SystemStatus } from "@/components/SystemBar";
import { IconArrowRight, IconPlus } from "@/components/ui/icons";
import { CountUp, Reveal, WordReveal } from "@/components/ui/motion";

interface CaseSummary {
  id: string;
  reference: string;
  title: string;
  creditor: string;
  debtor: string;
  claimedAmountPence: number;
  status: string;
  summary: string;
  run: { id: string; status: string; stepIndex: number } | null;
  defensiblePrincipalPence: number | null;
  confidence: number | null;
}

const poundsWhole = (pence: number) => money(Math.round(pence / 100) * 100).replace(/\.00$/, "");

function Stat({ label, value, format, hint, delay }: { label: string; value: number | null | undefined; format: (n: number) => string; hint: string; delay: number }) {
  return (
    <Reveal delay={delay} className="card frame p-5">
      <div className="label">{label}</div>
      <div className="mt-4 text-[32px] font-light leading-none tracking-[-0.03em]">
        <CountUp value={value} format={format} />
      </div>
      <div className="mt-3 text-[12px] text-ink-3">{hint}</div>
    </Reveal>
  );
}

export default function Dashboard() {
  const { data: cases, error } = usePoll<CaseSummary[]>("/api/cases", 2500);
  const { data: system } = usePoll<SystemStatus>("/api/system", 2500);

  return (
    <div className="space-y-14">
      <section className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <Reveal className="flex items-center gap-3">
            <span className="h-px w-8 bg-ink-3" />
            <span className="label">Autonomous dispute resolution · UK SMEs</span>
          </Reveal>
          <h1 className="mt-6 text-[40px] font-normal leading-[1.05] tracking-[-0.035em] md:text-[56px]">
            <WordReveal delayMs={120}>UK businesses are owed</WordReveal>
            <span className="word text-ink-3" style={{ animationDelay: "320ms" }}>£26.5bn</span>{" "}
            <WordReveal delayMs={380}>in late payments.</WordReveal>
            <br />
            <WordReveal delayMs={560}>Recover it, provably fairly.</WordReveal>
          </h1>
          <Reveal delay={800}>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink-2">
              Four agents gather evidence, reconcile the numbers, argue the debtor&apos;s side and draft the response.
              Every action is hash-chained and written to an on-chain audit log. Nothing leaves without a named human&apos;s approval.
            </p>
          </Reveal>
          <Reveal delay={950} className="mt-8 flex flex-wrap gap-3">
            <a href="#disputes" className="btn btn-primary">View disputes <IconArrowRight size={14} /></a>
            <Link href="/ledger" className="btn btn-ghost">Inspect the ledger</Link>
          </Reveal>
        </div>
        <Reveal delay={300} className="card frame relative p-4">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="label">System topology</span>
            <StatusBadge status={system?.chain.connected ? "anchored" : "pending"} label={system?.chain.connected ? "chain live" : "chain offline"} />
          </div>
          <HeroGraph />
        </Reveal>
      </section>

      <section aria-label="Portfolio" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat delay={0} label="Total claimed" value={system?.stats.claimedPence} format={poundsWhole} hint={`${system?.stats.cases ?? "—"} open disputes`} />
        <Stat delay={80} label="Defensible after challenge" value={system?.stats.defensiblePence} format={poundsWhole} hint="Principal the agents would stand behind" />
        <Stat delay={160} label="Awaiting approval" value={system?.stats.awaitingApproval} format={(n) => String(Math.round(n))} hint="Drafted actions held at the gate" />
        <Stat
          delay={240}
          label="Entries anchored on-chain"
          value={system?.ledger.anchored}
          format={(n) => `${Math.round(n)} / ${system?.ledger.total ?? 0}`}
          hint={system?.chain.connected ? `Network: ${system.chain.network}` : "Chain offline: entries queued"}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
        <Reveal as="section" delay={200} className="card frame overflow-hidden">
          <div id="disputes" className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[14px] font-medium">Disputes</h2>
              <span className="font-mono text-[10.5px] text-ink-3">{cases?.length ?? 0}</span>
            </div>
            <Link href="/cases/new" className="btn btn-ghost"><IconPlus size={14} /> New case</Link>
          </div>
          {error && <p role="alert" className="px-5 py-3 text-sm text-bad">Couldn&apos;t load cases: {error}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left">
                  {["Case", "Debtor", "Claimed", "Defensible", "Conf.", "Status", ""].map((h, i) => (
                    <th key={i} className={`label px-5 py-3 font-medium ${i >= 2 && i <= 4 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cases?.map((c, i) => (
                  <tr key={c.id} className="reveal group relative border-t border-line transition-colors hover:bg-white/[.02]" style={{ animationDelay: `${300 + i * 70}ms` }}>
                    <td className="px-5 py-4">
                      <Link href={`/cases/${c.id}`} className="font-medium after:absolute after:inset-0">{c.title}</Link>
                      <div className="mt-0.5 font-mono text-[10.5px] text-ink-3">{c.reference} · {c.creditor}</div>
                    </td>
                    <td className="px-5 py-4 text-ink-2">{c.debtor}</td>
                    <td className="px-5 py-4 text-right tabular-nums">{money(c.claimedAmountPence)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-ink-2">{money(c.defensiblePrincipalPence)}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-ink-2">{pct(c.confidence)}</td>
                    <td className="px-5 py-4"><StatusBadge status={c.run && ["queued", "running"].includes(c.run.status) ? "running" : c.status} /></td>
                    <td className="px-5 py-4 text-ink-3 transition-all duration-300 group-hover:translate-x-1 group-hover:text-ink"><IconArrowRight size={14} /></td>
                  </tr>
                ))}
                {cases?.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-ink-3">No cases yet. Create one to get started.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Reveal>
        <Reveal delay={300}>
          <ChainConsole heightClass="h-[300px]" />
        </Reveal>
      </div>
    </div>
  );
}
