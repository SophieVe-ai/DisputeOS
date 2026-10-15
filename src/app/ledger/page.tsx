"use client";
import { LedgerPanel } from "@/components/LedgerPanel";
import { usePoll } from "@/components/api";
import type { SystemStatus } from "@/components/SystemBar";

export default function LedgerPage() {
  const { data } = usePoll<SystemStatus>("/api/system", 3000);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Audit ledger</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          The global append-only log of every agent action and human decision across all cases. Each entry commits to the
          previous entry&apos;s hash, and each entry hash is written to the <code>AuditLog</code> contract, which has no update or delete function.
        </p>
      </header>
      {data && (
        <dl className="grid gap-4 sm:grid-cols-4">
          {[
            ["Network", data.chain.connected ? `${data.chain.network} (${data.chain.chainId})` : "offline"],
            ["Contract", data.chain.contractAddress ?? "—"],
            ["Entries", `${data.ledger.total}`],
            ["Anchored / pending", `${data.ledger.anchored} / ${data.ledger.pending + data.ledger.errored}`],
          ].map(([k, v]) => (
            <div key={k} className="card p-4">
              <dt className="label">{k}</dt>
              <dd className="mt-1 break-all font-mono text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <LedgerPanel demoMode={false} />
    </div>
  );
}
