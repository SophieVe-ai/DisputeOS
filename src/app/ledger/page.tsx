"use client";
import { ChainConsole } from "@/components/ChainConsole";
import { LedgerPanel } from "@/components/LedgerPanel";
import { usePoll } from "@/components/api";
import type { SystemStatus } from "@/components/SystemBar";
import { CountUp, Reveal, Scramble } from "@/components/ui/motion";

export default function LedgerPage() {
  const { data } = usePoll<SystemStatus>("/api/system", 3000);
  return (
    <div className="space-y-8">
      <Reveal as="header" className="border-b border-line pb-8">
        <span className="label">Audit ledger</span>
        <h1 className="mt-3 text-[34px] font-normal tracking-[-0.03em]">Every action, anchored.</h1>
        <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-ink-2">
          The global append-only log of every agent action and human decision across all cases. Each entry commits to the
          previous entry&apos;s hash, and each entry hash is written to the <code className="font-mono text-ink">AuditLog</code> contract, which has no update or delete function.
        </p>
      </Reveal>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Network", data ? (data.chain.connected ? `${data.chain.network} (${data.chain.chainId})` : "offline") : "—"],
          ["Contract", data?.chain.contractAddress ?? "—"],
        ].map(([k, v], i) => (
          <Reveal key={k} delay={i * 70} className="card frame p-4">
            <dt className="label">{k}</dt>
            <dd className="mt-2 break-all font-mono text-[12px]"><Scramble text={v} /></dd>
          </Reveal>
        ))}
        <Reveal delay={140} className="card frame p-4">
          <dt className="label">Entries</dt>
          <dd className="mt-2 text-[22px] font-light"><CountUp value={data?.ledger.total} format={(n) => String(Math.round(n))} /></dd>
        </Reveal>
        <Reveal delay={210} className="card frame p-4">
          <dt className="label">Anchored / pending</dt>
          <dd className="mt-2 text-[22px] font-light">
            <CountUp value={data?.ledger.anchored} format={(n) => String(Math.round(n))} />
            <span className="text-ink-3"> / {data ? data.ledger.pending + data.ledger.errored : "—"}</span>
          </dd>
        </Reveal>
      </dl>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_480px]">
        <LedgerPanel demoMode={false} />
        <div className="xl:sticky xl:top-20"><ChainConsole heightClass="h-[520px]" /></div>
      </div>
    </div>
  );
}
