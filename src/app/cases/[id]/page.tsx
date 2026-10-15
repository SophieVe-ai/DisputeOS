"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { CaseDocument, ChallengeOutput, DisputeCase, EvidenceOutput, Proposal, ReconciliationOutput, ResolutionOutput, Run, RunStep } from "@/lib/types";
import { ChallengePanel, EvidencePanel, ReconciliationPanel, ResolutionSummary } from "@/components/AgentPanels";
import { ApprovalGate } from "@/components/ApprovalGate";
import { api, usePoll } from "@/components/api";
import { humanise, money } from "@/components/format";
import { LedgerPanel } from "@/components/LedgerPanel";
import { Pipeline } from "@/components/Pipeline";
import { StatusBadge } from "@/components/StatusBadge";
import type { SystemStatus } from "@/components/SystemBar";

interface CaseDetail {
  case: DisputeCase;
  documents: CaseDocument[];
  run: Run | null;
  steps: RunStep[];
  proposals: Proposal[];
}

const output = <T,>(steps: RunStep[], agent: string) => steps.find((s) => s.agent === agent && s.status === "done")?.output as T | undefined;

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, refresh } = usePoll<CaseDetail>(`/api/cases/${id}`, 1200);
  const { data: system } = usePoll<SystemStatus>("/api/system", 5000);
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);

  if (error && !data) return <p role="alert" className="text-bad">{error}</p>;
  if (!data) return <p className="text-ink-3">Loading case…</p>;

  const { case: c, run, steps } = data;
  const busy = run !== null && ["queued", "running"].includes(run.status);
  const canRun = !run || ["completed", "failed"].includes(run.status);

  async function startRun() {
    setStarting(true);
    setRunError(null);
    try {
      const requestedBy = localStorage.getItem("disputeos.approver") || "operator";
      await api(`/api/cases/${id}/runs`, { method: "POST", body: JSON.stringify({ requestedBy }) });
      await refresh();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  const evidence = output<EvidenceOutput>(steps, "evidence");
  const recon = output<ReconciliationOutput>(steps, "reconciliation");
  const challenge = output<ChallengeOutput>(steps, "challenge");
  const resolution = output<ResolutionOutput>(steps, "resolution");

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-ink-3 hover:text-ink">← All cases</Link>
      <header className="card flex flex-wrap items-start gap-4 p-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-3">{c.reference}</span>
            <StatusBadge status={busy ? "running" : c.status} />
          </div>
          <h1 className="mt-1 text-2xl font-bold">{c.title}</h1>
          <p className="mt-1 text-sm text-ink-2">{c.creditor} <span className="text-ink-3">v</span> {c.debtor}</p>
          <p className="mt-2 max-w-3xl text-sm text-ink-2">{c.summary}</p>
        </div>
        <div className="text-right">
          <div className="label">Claimed</div>
          <div className="text-3xl font-bold tabular-nums">{money(c.claimedAmountPence)}</div>
          <button type="button" className="btn btn-primary mt-3" disabled={!canRun || starting} onClick={startRun}>
            {busy ? "Agents working…" : run ? "Re-run agents" : "▶ Run agents"}
          </button>
          {runError && <p role="alert" className="mt-2 text-xs text-bad">{runError}</p>}
        </div>
      </header>

      <Pipeline steps={steps} runStatus={run?.status ?? null} />
      {run?.status === "failed" && <p role="alert" className="card border-bad/50 p-4 text-sm text-bad">Run failed: {run.error}</p>}

      <section className="card p-5">
        <button type="button" className="flex w-full items-center justify-between" onClick={() => setShowDocs(!showDocs)} aria-expanded={showDocs}>
          <h2 className="font-semibold">📁 Case file ({data.documents.length} documents)</h2>
          <span className="text-sm text-ink-3">{showDocs ? "Hide" : "Show"}</span>
        </button>
        {showDocs && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {data.documents.map((d) => (
              <details key={d.id} className="rounded-lg border border-line bg-panel-2 p-3">
                <summary className="cursor-pointer text-sm font-medium">{d.title} <span className="text-xs text-ink-3">· {humanise(d.kind)} · {d.docDate ?? "undated"}</span></summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-ink-2">{d.content}</pre>
              </details>
            ))}
          </div>
        )}
      </section>

      {data.proposals.length > 0 && <ApprovalGate proposals={data.proposals} pinRequired={system?.approvalPinRequired ?? false} onDecided={refresh} />}

      <div className="grid gap-6 xl:grid-cols-2">
        {evidence && <EvidencePanel out={evidence} />}
        {recon && <ReconciliationPanel out={recon} />}
        {challenge && <ChallengePanel out={challenge} />}
        {resolution && <ResolutionSummary out={resolution} />}
      </div>

      <LedgerPanel caseId={c.id} demoMode={system?.demoMode ?? false} />
    </div>
  );
}
