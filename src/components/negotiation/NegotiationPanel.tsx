"use client";
import { useState } from "react";
import type { CorrespondenceMessage, DisputeCase, RunStatus, Wakeup } from "@/lib/types";
import { api, useApproverName } from "../api";
import { money } from "../format";
import { IconClock, IconNegotiation } from "../ui/icons";
import { ReplyComposer } from "./ReplyComposer";
import { Timeline } from "./Timeline";
import { until, useNow } from "./useNow";

export interface NegotiationProps {
  caseFile: DisputeCase;
  runStatus: RunStatus | null;
  correspondence: CorrespondenceMessage[];
  turns: Wakeup[];
  nextWakeup: Wakeup | null;
  demandPence: number | null;
  floorPence: number | null;
  demoMode: boolean;
  onChanged: () => void;
}

function headline(p: NegotiationProps): { title: string; body: string } {
  const debtor = p.caseFile.debtor;
  if (p.turns.some((t) => t.status === "processing")) return { title: "Reading the reply…", body: "The Negotiation agent is classifying the reply, checking it against our position and drafting the next move." };
  if (p.runStatus === "awaiting_approval") return { title: "Next move drafted", body: "Decide on it in the approval gate above. Any new reply waits until you have." };
  if (p.runStatus === "awaiting_response") return { title: `Listening for ${debtor}`, body: "The agent is asleep. A reply wakes it straight away; silence wakes it when the timer fires." };
  return { title: "Negotiation closed", body: "No further follow-up is scheduled for this case." };
}

function NextWake({ wakeup, debtor, demoMode, caseId, onChanged }: { wakeup: Wakeup; debtor: string; demoMode: boolean; caseId: string; onChanged: () => void }) {
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  async function fastForward() {
    setError(null);
    try {
      await api("/api/demo/fast-forward", { method: "POST", body: JSON.stringify({ caseId }) });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-panel-2 px-4 py-3">
      <IconClock size={15} className="text-ink-2" />
      <p className="text-[13px] text-ink-2">
        If {debtor} stays silent, the agent wakes on <strong className="font-medium text-ink">{wakeup.dueAt.slice(0, 10)}</strong>
        <span className="ml-2 font-mono text-[11px] text-ink-3">{now === null ? "" : until(wakeup.dueAt, now)}</span>
      </p>
      {demoMode && wakeup.kind === "deadline" && (
        <button type="button" className="btn btn-ghost ml-auto px-2 py-1 text-[11px]" onClick={fastForward} title="Demo only: fires the timer now. Logged on the ledger.">
          Fast-forward to deadline
        </button>
      )}
      {error && <p role="alert" className="w-full text-[12px] text-bad">{error}</p>}
    </div>
  );
}

export function NegotiationPanel(p: NegotiationProps) {
  const [approver] = useApproverName();
  const [error, setError] = useState<string | null>(null);
  const { title, body } = headline(p);
  const listening = p.runStatus === "awaiting_response";
  const engaged = listening || p.runStatus === "awaiting_approval";

  async function stop() {
    if (!window.confirm(`Stop following up and close this case? This is recorded on the ledger under ${approver || "your name"}.`)) return;
    setError(null);
    try {
      await api(`/api/cases/${p.caseFile.id}/close`, { method: "POST", body: JSON.stringify({ closedBy: approver }) });
      p.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="card frame reveal space-y-4 p-5" aria-labelledby="negotiation-title">
      <header className="flex flex-wrap items-start gap-3">
        <span className={`grid h-7 w-7 place-items-center rounded border ${listening ? "border-info/40 text-info" : "border-line-2 text-ink-2"}`}><IconNegotiation size={14} /></span>
        <div className="min-w-0 flex-1">
          <h3 id="negotiation-title" className="text-[14px] font-medium">{title}</h3>
          <p className="mt-1 text-[13px] text-ink-2">{body}</p>
        </div>
        <div className="text-right font-mono text-[10.5px] text-ink-3">
          <div>On the table <span className="text-ink">{money(p.demandPence)}</span></div>
          <div className="mt-1">Floor <span className="text-ink">{money(p.floorPence)}</span></div>
        </div>
      </header>
      {p.nextWakeup && listening && <NextWake wakeup={p.nextWakeup} debtor={p.caseFile.debtor} demoMode={p.demoMode} caseId={p.caseFile.id} onChanged={p.onChanged} />}
      <Timeline messages={p.correspondence} turns={p.turns} />
      {engaged && <ReplyComposer caseFile={p.caseFile} demandPence={p.demandPence} floorPence={p.floorPence} demoMode={p.demoMode} onSent={p.onChanged} />}
      {listening && (
        <div className="flex items-center gap-3">
          {error && <p role="alert" className="text-[12px] text-bad">{error}</p>}
          <button type="button" className="btn btn-ghost ml-auto text-[12px]" disabled={approver.trim().length < 2} onClick={stop} title={approver.trim().length < 2 ? "Enter your name in the approval gate first" : undefined}>
            Stop following up
          </button>
        </div>
      )}
    </section>
  );
}
