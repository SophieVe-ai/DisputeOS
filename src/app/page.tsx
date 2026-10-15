"use client";
import Link from "next/link";
import { usePoll } from "@/components/api";
import { money, pct } from "@/components/format";
import { StatusBadge } from "@/components/StatusBadge";
import type { SystemStatus } from "@/components/SystemBar";

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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <div className="label">{label}</div>
      <div className="mt-2 text-3xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { data: cases, error } = usePoll<CaseSummary[]>("/api/cases", 2500);
  const { data: system } = usePoll<SystemStatus>("/api/system", 2500);

  return (
    <div className="space-y-8">
      <section className="card relative overflow-hidden p-8">
        <div aria-hidden className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
        <p className="label text-accent-2">AI-native dispute resolution for UK SMEs</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight md:text-4xl">
          UK businesses were owed about <span className="text-accent-2">£26.5 billion</span> in late payments last year.
          DisputeOS gets it back. You stay in control.
        </h1>
        <p className="mt-3 max-w-3xl text-ink-2">
          Four autonomous agents gather evidence, reconcile the numbers, argue the debtor&apos;s side and draft the response.
          Every step is hash-chained and anchored on-chain, and nothing is sent without your approval.
        </p>
        <div className="mt-5 flex flex-wrap gap-2 text-xs text-ink-2">
          {["1 · Evidence", "2 · Reconciliation", "3 · Challenge", "4 · Resolution", "5 · Human approval"].map((s) => (
            <span key={s} className="rounded-full border border-line px-3 py-1">{s}</span>
          ))}
        </div>
      </section>

      <section aria-label="Portfolio" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total claimed" value={money(system?.stats.claimedPence)} hint={`${system?.stats.cases ?? "—"} cases`} />
        <Stat label="Defensible after challenge" value={money(system?.stats.defensiblePence)} hint="Principal the agents would stand behind" />
        <Stat label="Awaiting your approval" value={String(system?.stats.awaitingApproval ?? "—")} hint="Drafted actions held at the gate" />
        <Stat
          label="Ledger entries on-chain"
          value={system ? `${system.ledger.anchored}/${system.ledger.total}` : "—"}
          hint={system?.chain.connected ? `Anchored on ${system.chain.network}` : "Chain offline — entries queued"}
        />
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold">Disputes</h2>
          <Link href="/cases/new" className="btn btn-primary">+ New case</Link>
        </div>
        {error && <p role="alert" className="px-5 py-3 text-sm text-bad">Couldn&apos;t load cases: {error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-3">
              <tr>
                <th className="px-5 py-3 font-medium">Case</th>
                <th className="px-5 py-3 font-medium">Debtor</th>
                <th className="px-5 py-3 text-right font-medium">Claimed</th>
                <th className="px-5 py-3 text-right font-medium">Defensible</th>
                <th className="px-5 py-3 text-right font-medium">Confidence</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {cases?.map((c) => (
                <tr key={c.id} className="border-t border-line hover:bg-panel-2">
                  <td className="px-5 py-3">
                    <Link href={`/cases/${c.id}`} className="font-medium hover:text-accent-2">{c.title}</Link>
                    <div className="text-xs text-ink-3">{c.reference} · {c.creditor}</div>
                  </td>
                  <td className="px-5 py-3 text-ink-2">{c.debtor}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{money(c.claimedAmountPence)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{money(c.defensiblePrincipalPence)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{pct(c.confidence)}</td>
                  <td className="px-5 py-3"><StatusBadge status={c.run && ["queued", "running"].includes(c.run.status) ? "running" : c.status} /></td>
                </tr>
              ))}
              {cases?.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-3">No cases yet. Create one to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
