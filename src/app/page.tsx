"use client";
import Link from "next/link";
import { usePoll } from "@/components/api";
import { ChainConsole } from "@/components/ChainConsole";
import { money, pct } from "@/components/format";
import { HeroGraph } from "@/components/HeroGraph";
import { HomeHero } from "@/components/HomeHero";
import { IllusAnchor, IllusChallenge, IllusIngest, IllusReconcile } from "@/components/Illustrations";
import { StatusBadge } from "@/components/StatusBadge";
import type { SystemStatus } from "@/components/SystemBar";
import { IconArrowRight, IconPlus } from "@/components/ui/icons";
import { CountUp, Reveal } from "@/components/ui/motion";

interface CaseSummary {
  id: string;
  reference: string;
  title: string;
  creditor: string;
  debtor: string;
  claimedAmountPence: number;
  status: string;
  run: { id: string; status: string; stepIndex: number } | null;
  defensiblePrincipalPence: number | null;
  confidence: number | null;
}

const poundsWhole = (pence: number) => money(Math.round(pence / 100) * 100).replace(/\.00$/, "");

const STEPS = [
  { n: "01", title: "Ingest", body: "Drop in contracts, invoices, delivery notes, remittances and emails. Each is classified, parsed and hashed.", Illus: IllusIngest },
  { n: "02", title: "Reconcile", body: "Every line is checked against the contract and the delivery record. Deterministic: no model touches the money.", Illus: IllusReconcile },
  { n: "03", title: "Challenge", body: "A devil's-advocate agent argues the debtor's case under English law and keeps only what is defensible.", Illus: IllusChallenge },
  { n: "04", title: "Anchor", body: "Every action and every human decision is hash-chained and written to an append-only smart contract.", Illus: IllusAnchor },
];

function SectionHeader({ index, title, aside }: { index: string; title: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 border-b border-line pb-4">
      <div className="flex items-baseline gap-4">
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-ink-3">{index}</span>
        <h2 className="text-[22px] font-normal tracking-[-0.02em]">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

function Stat({ label, value, format, hint, delay }: { label: string; value: number | null | undefined; format: (n: number) => string; hint: string; delay: number }) {
  return (
    <Reveal delay={delay} className="card frame p-5">
      <div className="label">{label}</div>
      <div className="mt-4 text-[32px] font-light leading-none tracking-[-0.03em]"><CountUp value={value} format={format} /></div>
      <div className="mt-3 text-[12px] text-ink-3">{hint}</div>
    </Reveal>
  );
}

export default function Dashboard() {
  const { data: cases, error } = usePoll<CaseSummary[]>("/api/cases", 2500);
  const { data: system } = usePoll<SystemStatus>("/api/system", 2500);

  return (
    <div className="space-y-20">
      <HomeHero />

      <section aria-label="Portfolio" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat delay={0} label="Total claimed" value={system?.stats.claimedPence} format={poundsWhole} hint={`${system?.stats.cases ?? "—"} disputes`} />
        <Stat delay={80} label="Defensible after challenge" value={system?.stats.defensiblePence} format={poundsWhole} hint="Principal the agents would stand behind" />
        <Stat delay={160} label="Awaiting approval" value={system?.stats.awaitingApproval} format={(n) => String(Math.round(n))} hint="Drafted actions held at the gate" />
        <Stat delay={240} label="Entries anchored on-chain" value={system?.ledger.anchored} format={(n) => `${Math.round(n)} / ${system?.ledger.total ?? 0}`} hint={system?.chain.connected ? `Network: ${system.chain.network}` : "Chain offline: entries queued"} />
      </section>

      <section>
        <SectionHeader index="01" title="Disputes and the live ledger" aside={<Link href="/cases/new" className="btn btn-ghost"><IconPlus size={14} /> Upload case file</Link>} />
        <div className="grid gap-6 xl:grid-cols-[1fr_460px]">
          <div className="card frame overflow-hidden">
            {error && <p role="alert" className="px-5 py-3 text-sm text-bad">Couldn&apos;t load cases: {error}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left">
                    {["Case", "Debtor", "Claimed", "Defensible", "Conf.", "Status", ""].map((h, i) => (
                      <th key={i} className={`label px-5 py-3.5 font-medium ${i >= 2 && i <= 4 ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cases?.map((c, i) => (
                    <tr key={c.id} className="reveal group relative border-t border-line transition-colors hover:bg-white/[.02]" style={{ animationDelay: `${i * 60}ms` }}>
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
                    <tr>
                      <td colSpan={7} className="px-5 py-16">
                        <div className="mx-auto flex max-w-md flex-col items-center text-center">
                          <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden className="float-y text-ink-3">
                            <rect x="12" y="6" width="32" height="42" rx="3" fill="none" stroke="currentColor" />
                            <path d="M33 6v10h11" fill="none" stroke="currentColor" />
                            <path d="M28 40V24m-6 6 6-6 6 6" fill="none" stroke="var(--ink)" strokeWidth="1.5" className="pop-tag" />
                          </svg>
                          <p className="mt-4 text-[15px] text-ink">No disputes yet</p>
                          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">Upload a contract, invoices, delivery notes and emails, or pick one of the sample case files. The agents take it from there.</p>
                          <Link href="/cases/new" className="btn btn-primary mt-5"><IconPlus size={14} /> Upload a case file</Link>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <ChainConsole heightClass="h-[300px]" />
        </div>
      </section>

      <section>
        <SectionHeader index="02" title="How it works" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 90} className="card frame group flex flex-col overflow-hidden">
              <div className="border-b border-line bg-[#070808] px-4 pt-4 transition-colors duration-500 group-hover:bg-[#0a0b0c]"><s.Illus /></div>
              <div className="p-5">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[10.5px] tracking-[0.14em] text-ink-3">{s.n}</span>
                  <h3 className="text-[15px] font-medium">{s.title}</h3>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader index="03" title="System topology" aside={<StatusBadge status={system?.chain.connected ? "anchored" : "pending"} label={system?.chain.connected ? "chain live" : "chain offline"} />} />
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-5 text-[14px] leading-relaxed text-ink-2">
            <p>Agents never hold a database handle or a signing key. They get a single <code className="font-mono text-ink">append</code> closure, and the orchestrator fixes their identity.</p>
            <p>Each write is hash-chained to the one before it and anchored, in order, to <code className="font-mono text-ink">AuditLog.sol</code>. The contract has no edit or delete function, so not even an insider with raw database access can quietly rewrite what an agent decided.</p>
            <Link href="/ledger" className="inline-flex items-center gap-2 text-ink transition-colors hover:text-white">Inspect the ledger <IconArrowRight size={14} /></Link>
          </div>
          <div className="card frame p-4"><HeroGraph /></div>
        </div>
      </section>
    </div>
  );
}
