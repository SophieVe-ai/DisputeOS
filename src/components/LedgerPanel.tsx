"use client";
import { useState } from "react";
import type { LedgerEntry, VerificationReport } from "@/lib/ledger/ledger";
import { api, usePoll } from "./api";
import { shortHash, time } from "./format";
import { StatusBadge } from "./StatusBadge";

export function LedgerPanel({ caseId, demoMode }: { caseId?: string; demoMode: boolean }) {
  const url = caseId ? `/api/ledger?caseId=${encodeURIComponent(caseId)}` : "/api/ledger?limit=300";
  const { data: entries, refresh } = usePoll<LedgerEntry[]>(url, 2000);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setMessage(null);
    try {
      setReport(await api<VerificationReport>("/api/ledger/verify", { method: "POST", body: JSON.stringify(caseId ? { caseId } : {}) }));
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function tamper() {
    if (!caseId) return;
    setBusy(true);
    try {
      const r = await api<{ seq: number; action: string }>("/api/demo/tamper", { method: "POST", body: JSON.stringify({ caseId }) });
      setMessage(`Simulated insider attack: rewrote entry #${r.seq} (${r.action}) directly in the database and recomputed its hash. Now run verification.`);
      setReport(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const bySeq = new Map(report?.entries.map((e) => [e.seq, e]) ?? []);

  return (
    <section className="card p-5" aria-labelledby="ledger-title">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h3 id="ledger-title" className="font-semibold">⛓ Tamper-evident audit ledger</h3>
          <p className="text-sm text-ink-2">Each agent action is SHA-256 hash-chained and anchored to the AuditLog smart contract. Agents can append to the log but never edit it.</p>
        </div>
        <div className="ml-auto flex gap-2">
          {caseId && demoMode && <button type="button" className="btn btn-bad" disabled={busy} onClick={tamper}>☠ Simulate tampering</button>}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={verify}>{busy ? "Verifying…" : "Verify against chain"}</button>
        </div>
      </div>
      {message && <p role="status" className="mt-3 rounded-lg border border-warn/40 p-3 text-sm text-warn">{message}</p>}
      {report && (
        <div role="status" className={`mt-3 rounded-lg border p-3 text-sm ${report.ok ? "border-good/40 text-good" : "border-bad/50 text-bad"}`}>
          {report.ok
            ? `✓ All ${report.checked} entries intact${report.chain.available ? ` and match ${report.chain.onChainCount} on-chain anchors (chain ${report.chain.chainId}, contract ${shortHash(report.chain.contractAddress)})` : " (local hash chain only; blockchain unavailable)"}.`
            : `✕ TAMPERING DETECTED: ${report.failures - report.missingFromDb} of ${report.checked} entries failed verification${report.missingFromDb > 0 ? `, and ${report.missingFromDb} on-chain entries are missing from the database` : ""}. See the highlighted rows below.`}
        </div>
      )}
      <div className="mt-4 max-h-[32rem] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel text-left text-ink-3">
            <tr>
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Time</th>
              <th className="py-2 pr-2 font-medium">Actor</th>
              <th className="py-2 pr-2 font-medium">Action</th>
              <th className="py-2 pr-2 font-medium">Entry hash</th>
              <th className="py-2 pr-2 font-medium">Anchor</th>
              {report && <th className="py-2 font-medium">Verification</th>}
            </tr>
          </thead>
          <tbody>
            {entries?.map((e) => {
              const v = bySeq.get(e.seq);
              const bad = v && v.problems.length > 0;
              return (
                <tr key={e.seq} className={`border-t border-line ${bad ? "bg-bad/10" : ""}`}>
                  <td className="py-1.5 pr-2 tabular-nums text-ink-3">{e.seq}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap text-ink-3">{time(e.createdAt)}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{e.actor}</td>
                  <td className="py-1.5 pr-2 font-mono">{e.action}</td>
                  <td className="py-1.5 pr-2 font-mono text-ink-3" title={e.entryHash}>{shortHash(e.entryHash)}</td>
                  <td className="py-1.5 pr-2" title={e.anchor.txHash ? `tx ${e.anchor.txHash} · block ${e.anchor.blockNumber}` : (e.anchor.error ?? "")}>
                    <StatusBadge status={e.anchor.status} label={e.anchor.status === "anchored" && e.anchor.blockNumber ? `block ${e.anchor.blockNumber}` : e.anchor.status} />
                  </td>
                  {report && (
                    <td className="py-1.5">
                      {v ? (bad ? <span className="text-bad">✕ {v.problems.join("; ")}</span> : <StatusBadge status={v.onChain === "match" ? "match" : v.onChain} label={v.onChain === "match" ? "on-chain match" : v.onChain} />) : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
