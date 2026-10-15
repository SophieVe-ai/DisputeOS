"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { CaseDocument, ChallengeOutput, DisputeCase, EvidenceOutput, Proposal, ReconciliationOutput, ResolutionOutput, Run, RunStep } from "@/lib/types";
import { ChallengePanel, EvidencePanel, ReconciliationPanel, ResolutionSummary } from "@/components/AgentPanels";
import { ApprovalGate } from "@/components/ApprovalGate";
import { api, usePoll } from "@/components/api";
import { ChainConsole } from "@/components/ChainConsole";
import { humanise, money } from "@/components/format";
import { LedgerPanel } from "@/components/LedgerPanel";
import { Pipeline } from "@/components/Pipeline";
import { StatusBadge } from "@/components/StatusBadge";
import type { SystemStatus } from "@/components/SystemBar";
import { IconArrowLeft, IconFolder, IconPlay } from "@/components/ui/icons";
import { CountUp, Reveal } from "@/components/ui/motion";

interface CaseDetail {
  case: DisputeCase;
  documents: CaseDocument[];
  run: Run | null;
  steps: RunStep[];
  proposals: Proposal[];
}

/** One plain-language instruction for whatever the user should do next. */
function NextStep({ runStatus, pending, onRun, canRun, starting }: { runStatus: string | null; pending: number; onRun: () => void; canRun: boolean; starting: boolean }) {
  const steps: Record<string, { tone: string; title: string; body: string }> = {
    none: { tone: "border-line-2", title: "Ready when you are", body: "Run the agents to review the documents, check the numbers and draft a response. Takes a few seconds; nothing is sent." },
    queued: { tone: "border-info/40", title: "Agents are working", body: "Follow each step in the pipeline below and watch every action land in the on-chain log on the right." },
    awaiting_approval: { tone: "border-warn/40", title: `${pending} drafted ${pending === 1 ? "action needs" : "actions need"} your decision`, body: "Open each one below, read the document, then approve or reject it. Only approved actions are carried out, and your decision is recorded on-chain." },
    completed: { tone: "border-good/40", title: "All decisions recorded", body: "Every approved action has been carried out. Verify the audit trail against the blockchain at the bottom of the page." },
    failed: { tone: "border-bad/40", title: "The run failed", body: "Something went wrong after several retries. Check the error, then run the agents again." },
  };
  const key = runStatus === "running" ? "queued" : (runStatus ?? "none");
  const s = steps[key] ?? steps.none;
  return (
    <section aria-live="polite" className={`card reveal flex flex-wrap items-center gap-4 border-l-2 px-5 py-4 ${s.tone}`}>
      <div className="min-w-0 flex-1">
        <h2 className="text-[14px] font-medium">{s.title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{s.body}</p>
      </div>
      {(key === "none" || key === "failed") && (
        <button type="button" className="btn btn-primary" disabled={!canRun || starting} onClick={onRun}><IconPlay size={12} /> Run agents</button>
      )}
    </section>
  );
}

const output = <T,>(steps: RunStep[], agent: string) => steps.find((s) => s.agent === agent && s.status === "done")?.output as T | undefined;

function CaseFile({ documents }: { documents: CaseDocument[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card frame">
      <button type="button" className="flex w-full items-center gap-3 px-5 py-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <IconFolder size={16} className="text-ink-2" />
        <h2 className="text-[14px] font-medium">Case file</h2>
        <span className="font-mono text-[10.5px] text-ink-3">{documents.length} documents</span>
        <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">{open ? "Collapse" : "Expand"}</span>
      </button>
      {open && (
        <div className="grid gap-2 border-t border-line p-4 md:grid-cols-2">
          {documents.map((d, i) => (
            <details key={d.id} className="reveal rounded border border-line bg-panel-2 px-3 py-2.5" style={{ animationDelay: `${i * 40}ms` }}>
              <summary className="cursor-pointer text-[13px] font-medium">
                {d.title} <span className="font-mono text-[10.5px] text-ink-3">· {humanise(d.kind)} · {d.docDate ?? "undated"}</span>
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-2">{d.content}</pre>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, refresh } = usePoll<CaseDetail>(`/api/cases/${id}`, 1200);
  const { data: system } = usePoll<SystemStatus>("/api/system", 5000);
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  if (error && !data) return <p role="alert" className="text-bad">{error}</p>;
  if (!data) return <p className="font-mono text-[12px] text-ink-3">Loading case…</p>;

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
      <Link href="/" className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3 transition-colors hover:text-ink">
        <IconArrowLeft size={13} /> All cases
      </Link>

      <Reveal as="header" className="flex flex-wrap items-end gap-6 border-b border-line pb-8">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-mono text-[11px] text-ink-3">{c.reference}</span>
            <StatusBadge status={busy ? "running" : c.status} />
          </div>
          <h1 className="mt-3 text-[34px] font-normal leading-tight tracking-[-0.03em]">{c.title}</h1>
          <p className="mt-2 text-[14px] text-ink-2">{c.creditor} <span className="px-1 text-ink-3">v</span> {c.debtor}</p>
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-ink-3">{c.summary}</p>
        </div>
        <div className="text-right">
          <div className="label">Claimed</div>
          <div className="mt-2 text-[40px] font-light leading-none tracking-[-0.03em]">
            <CountUp value={c.claimedAmountPence} format={(n) => money(Math.round(n))} />
          </div>
          <button type="button" className="btn btn-primary mt-5" disabled={!canRun || starting} onClick={startRun}>
            {busy ? (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" className="spin" aria-hidden><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.5" /><path d="M6 1a5 5 0 0 1 5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
                Agents working
              </>
            ) : (
              <><IconPlay size={12} /> {run ? "Re-run agents" : "Run agents"}</>
            )}
          </button>
          {runError && <p role="alert" className="mt-2 text-xs text-bad">{runError}</p>}
        </div>
      </Reveal>

      <NextStep runStatus={run?.status ?? null} pending={data.proposals.filter((p) => p.status === "pending").length} onRun={startRun} canRun={canRun} starting={starting} />
      <Reveal delay={100}><Pipeline steps={steps} runStatus={run?.status ?? null} /></Reveal>
      {run?.status === "failed" && <p role="alert" className="card border-bad/50 p-4 text-sm text-bad">Run failed: {run.error}</p>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="min-w-0 space-y-6">
          {data.proposals.length > 0 && <ApprovalGate proposals={data.proposals} pinRequired={system?.approvalPinRequired ?? false} onDecided={refresh} />}
          <Reveal delay={150}><CaseFile documents={data.documents} /></Reveal>
          {(evidence || recon || challenge || resolution) && <h2 className="label pt-2">What the agents found</h2>}
          <div className="grid gap-6 2xl:grid-cols-2">
            {evidence && <EvidencePanel out={evidence} />}
            {recon && <ReconciliationPanel out={recon} />}
            {challenge && <ChallengePanel out={challenge} />}
            {resolution && <ResolutionSummary out={resolution} />}
          </div>
        </div>
        <Reveal delay={200} className="xl:sticky xl:top-20">
          <ChainConsole caseId={c.id} heightClass="h-[420px] xl:h-[calc(100vh-330px)]" />
        </Reveal>
      </div>

      <LedgerPanel caseId={c.id} demoMode={system?.demoMode ?? false} />
    </div>
  );
}
