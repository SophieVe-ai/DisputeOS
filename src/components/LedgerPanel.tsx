"use client";
import { useState } from "react";
import type { LedgerEntry, VerificationReport } from "@/lib/ledger/ledger";
import { api, usePoll } from "./api";
import { shortHash, time } from "./format";
import { StatusBadge } from "./StatusBadge";
import { IconChain, IconScan, IconSkull } from "./ui/icons";

/** Animated verdict mark: the stroke draws itself in. */
function VerdictMark({ ok }: { ok: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden className={ok ? "text-good" : "text-bad"}>
      <circle cx="14" cy="14" r="13" fill="none" stroke="currentColor" strokeOpacity=".35" className="draw" style={{ ["--len" as string]: 82 }} />
      {ok ? (
        <path d="M8.5 14.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="1.8" className="draw" style={{ ["--len" as string]: 20, animationDelay: "250ms" }} />
      ) : (
        <path d="M9.5 9.5l9 9M18.5 9.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" className="draw" style={{ ["--len" as string]: 26, animationDelay: "250ms" }} />
      )}
    </svg>
  );
}

export function LedgerPanel({ caseId, demoMode }: { caseId?: string; demoMode: boolean }) {
  const url = caseId ? `/api/ledger?caseId=${encodeURIComponent(caseId)}` : "/api/ledger?limit=300";
  const { data: entries, refresh } = usePoll<LedgerEntry[]>(url, 2000);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [busy, setBusy] = useState<"verify" | "tamper" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tamperedSeq, setTamperedSeq] = useState<number | null>(null);

  async function verify() {
    setBusy("verify");
    setMessage(null);
    try {
      setReport(await api<VerificationReport>("/api/ledger/verify", { method: "POST", body: JSON.stringify(caseId ? { caseId } : {}) }));
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function tamper() {
    if (!caseId) return;
    setBusy("tamper");
    try {
      const r = await api<{ seq: number; action: string }>("/api/demo/tamper", { method: "POST", body: JSON.stringify({ caseId }) });
      setMessage(`Simulated insider attack: rewrote entry #${r.seq} (${r.action}) directly in the database and recomputed its hash. Now verify against the chain.`);
      setTamperedSeq(r.seq);
      setReport(null);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const bySeq = new Map(report?.entries.map((e) => [e.seq, e]) ?? []);

  return (
    <section className="card frame p-5" aria-labelledby="ledger-title">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-7 w-7 place-items-center rounded border border-line-2 text-ink-2"><IconChain size={14} /></span>
          <div>
            <h3 id="ledger-title" className="text-[14px] font-medium">Tamper-evident audit ledger</h3>
            <p className="mt-1 max-w-2xl text-[13px] text-ink-2">Each action is SHA-256 hash-chained and anchored to the AuditLog contract. Agents can append to the log but never edit it.</p>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {caseId && demoMode && (
            <button type="button" className="btn btn-bad" disabled={busy !== null} onClick={tamper}><IconSkull size={14} /> Simulate tampering</button>
          )}
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={verify}>
            <IconScan size={14} /> {busy === "verify" ? "Verifying…" : "Verify against chain"}
          </button>
        </div>
      </div>

      {message && <p role="status" className="reveal mt-4 rounded border border-warn/30 bg-warn/[.04] px-4 py-3 text-[13px] text-warn">{message}</p>}
      {report && (
        <div role="status" className={`reveal mt-4 flex items-center gap-4 rounded border px-4 py-3 text-[13px] ${report.ok ? "border-good/30 bg-good/[.04] text-good" : "border-bad/40 bg-bad/[.05] text-bad"}`}>
          <VerdictMark ok={report.ok} />
          <span>
            {report.ok
              ? `All ${report.checked} entries intact${report.chain.available ? ` and match ${report.chain.onChainCount} on-chain anchors (chain ${report.chain.chainId}, contract ${shortHash(report.chain.contractAddress)})` : " (local hash chain only; blockchain unavailable)"}.`
              : `Tampering detected: ${report.failures - report.missingFromDb} of ${report.checked} entries failed verification${report.missingFromDb > 0 ? `, and ${report.missingFromDb} on-chain entries are missing from the database` : ""}. See the highlighted rows below.`}
          </span>
        </div>
      )}

      <div className="relative mt-5 max-h-[32rem] overflow-auto rounded border border-line">
        {busy === "verify" && <div aria-hidden className="scanner z-10" />}
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-[5] bg-panel text-left">
            <tr>
              {["#", "Time", "Actor", "Action", "Entry hash", "Anchor", ...(report ? ["Verification"] : [])].map((h) => (
                <th key={h} className="label px-3 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries?.map((e) => {
              const v = bySeq.get(e.seq);
              const bad = Boolean(v && v.problems.length > 0);
              return (
                <tr key={e.seq} className={`border-t border-line transition-colors ${bad ? "glitch bg-bad/[.07]" : e.seq === tamperedSeq && !report ? "bg-warn/[.05]" : ""}`}>
                  <td className="px-3 py-2 font-mono tabular-nums text-ink-3">{e.seq}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-ink-3">{time(e.createdAt)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 font-mono ${e.actor.startsWith("human:") ? "text-warn" : e.actor.startsWith("agent:") ? "text-info" : "text-ink-2"}`}>{e.actor}</td>
                  <td className="px-3 py-2 font-mono">{e.action}</td>
                  <td className="px-3 py-2 font-mono text-ink-3" title={e.entryHash}>{shortHash(e.entryHash)}</td>
                  <td className="px-3 py-2" title={e.anchor.txHash ? `tx ${e.anchor.txHash} · block ${e.anchor.blockNumber}` : (e.anchor.error ?? "")}>
                    <StatusBadge status={e.anchor.status} label={e.anchor.status === "anchored" && e.anchor.blockNumber ? `block ${e.anchor.blockNumber}` : e.anchor.status} />
                  </td>
                  {report && (
                    <td className="px-3 py-2">
                      {v ? (bad ? <span className="text-bad">{v.problems.join("; ")}</span> : <StatusBadge status={v.onChain === "match" ? "match" : v.onChain} label={v.onChain === "match" ? "on-chain match" : v.onChain} />) : "—"}
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
