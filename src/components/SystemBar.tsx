"use client";
import { usePoll } from "./api";
import { shortHash } from "./format";

export interface SystemStatus {
  engine: { mode: "claude" | "deterministic"; model: string | null };
  chain: { connected: boolean; chainId?: string; contractAddress?: string; network?: string; error: string | null };
  worker: { running: boolean; activeRuns: number };
  ledger: { total: number; anchored: number; pending: number; errored: number };
  demoMode: boolean;
  approvalPinRequired: boolean;
  baseRatePercent: number;
  stats: { cases: number; claimedPence: number; defensiblePence: number; awaitingApproval: number; active: number };
}

export function SystemBar() {
  const { data } = usePoll<SystemStatus>("/api/system", 4000);
  if (!data) return <span className="text-xs text-ink-3">Connecting…</span>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full border border-line px-2 py-1 text-ink-2" title={data.engine.model ?? "Rule-based engine (no API key)"}>
        <span aria-hidden>🧠 </span>
        {data.engine.mode === "claude" ? `Claude · ${data.engine.model}` : "Deterministic engine"}
      </span>
      <span
        className={`rounded-full border px-2 py-1 ${data.chain.connected ? "border-good/40 text-good" : "border-warn/40 text-warn"}`}
        title={data.chain.connected ? `Contract ${data.chain.contractAddress}` : (data.chain.error ?? "")}
      >
        <span aria-hidden>⛓ </span>
        {data.chain.connected ? `${data.chain.network} · ${shortHash(data.chain.contractAddress)}` : "Chain offline — local hash chain only"}
      </span>
    </div>
  );
}
