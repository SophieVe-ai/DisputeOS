"use client";
import { usePoll } from "./api";
import { shortHash } from "./format";
import { StatusBadge } from "./StatusBadge";

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
  if (!data) return <StatusBadge status="queued" label="connecting" />;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <span title={data.engine.model ?? "Rule-based engine (no API key)"}>
        <StatusBadge status={data.engine.mode === "claude" ? "completed" : "open"} label={data.engine.mode === "claude" ? `claude · ${data.engine.model}` : "deterministic engine"} />
      </span>
      <span title={data.chain.connected ? `Contract ${data.chain.contractAddress}` : (data.chain.error ?? "")}>
        <StatusBadge
          status={data.chain.connected ? "anchored" : "pending"}
          label={data.chain.connected ? `${data.chain.network} · ${shortHash(data.chain.contractAddress)}` : "chain offline"}
        />
      </span>
    </div>
  );
}
