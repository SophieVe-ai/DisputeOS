"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Proposal } from "@/lib/types";
import { api, useApproverName } from "./api";
import { humanise, money, time } from "./format";
import { StatusBadge } from "./StatusBadge";
import { IconCheck, IconGate } from "./ui/icons";

export function ApprovalGate({ proposals, pinRequired, onDecided }: { proposals: Proposal[]; pinRequired: boolean; onDecided: () => void }) {
  const [approver, setApprover] = useApproverName();
  const [pin, setPin] = useState("");
  const [open, setOpen] = useState<string | null>(proposals[0]?.id ?? null);
  const pending = proposals.filter((p) => p.status === "pending").length;

  return (
    <section className={`card frame reveal p-5 ${pending ? "border-warn/30" : ""}`} aria-labelledby="gate-title">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex items-start gap-3">
          <span className={`grid h-7 w-7 place-items-center rounded border ${pending ? "border-warn/40 text-warn" : "border-line-2 text-ink-2"}`}><IconGate size={14} /></span>
          <div>
            <h3 id="gate-title" className="text-[14px] font-medium">Approval gate <span className="ml-2 font-mono text-[10.5px] text-ink-3">{pending} pending</span></h3>
            <p className="mt-1 max-w-xl text-[13px] text-ink-2">Agents have drafted these actions. Nothing is sent until a named person approves it, and each decision is written on-chain.</p>
          </div>
        </div>
        <label className="ml-auto block w-52">
          <span className="label">Approver</span>
          <input className="input mt-1.5" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Your full name" />
        </label>
        {pinRequired && (
          <label className="block w-28">
            <span className="label">PIN</span>
            <input className="input mt-1.5" type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
          </label>
        )}
      </div>
      <ul className="mt-5 space-y-2">
        {proposals.map((p) => (
          <ProposalCard key={p.id} p={p} approver={approver} pin={pin} expanded={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onDecided={onDecided} />
        ))}
      </ul>
    </section>
  );
}

function ProposalCard({ p, approver, pin, expanded, onToggle, onDecided }: { p: Proposal; approver: string; pin: string; expanded: boolean; onToggle: () => void; onDecided: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/proposals/${p.id}/decision`, { method: "POST", body: JSON.stringify({ decision, approver, note: note || null, pin: pin || null }) });
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`rounded border bg-panel-2 transition-colors ${expanded ? "border-line-2" : "border-line hover:border-line-2"}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full flex-wrap items-center gap-4 px-4 py-3 text-left">
        <StatusBadge status={p.status} />
        <span className="text-[13px] font-medium">{p.title}</span>
        <span className="font-mono text-[10.5px] text-ink-3">{humanise(p.kind)}</span>
        <span className="ml-auto text-[14px] tabular-nums">{money(p.amountPence)}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`text-ink-3 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`}><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
      </button>
      {expanded && (
        <div className="reveal space-y-4 border-t border-line p-4">
          <p className="text-[13px] text-ink-2"><span className="text-ink-3">Rationale — </span>{p.rationale}</p>
          <article className="prose-doc max-h-[28rem] overflow-auto rounded bg-[#f7f6f2] p-7 text-[13px] text-[#1b1b19] shadow-[0_20px_60px_-30px_rgba(0,0,0,.8)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={["img"]} unwrapDisallowed>{p.documentBody}</ReactMarkdown>
          </article>
          {p.status === "pending" ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="block flex-1">
                <span className="label">Note (optional)</span>
                <input className="input mt-1.5" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </label>
              <button type="button" className="btn btn-bad" disabled={busy || approver.trim().length < 2} onClick={() => decide("reject")}>Reject</button>
              <button type="button" className="btn btn-good" disabled={busy || approver.trim().length < 2} onClick={() => decide("approve")}>
                <IconCheck size={14} /> Approve &amp; execute
              </button>
            </div>
          ) : (
            <p className="text-[13px] text-ink-2">
              {p.status === "rejected" ? "Rejected" : "Approved"} by <strong className="font-medium text-ink">{p.decidedBy}</strong> at {time(p.decidedAt)}{p.decisionNote ? ` — “${p.decisionNote}”` : ""}.
              {p.executionResult && <span className="mt-1 flex items-center gap-1.5 text-good"><IconCheck size={13} /> {p.executionResult}</span>}
            </p>
          )}
          {approver.trim().length < 2 && p.status === "pending" && <p className="font-mono text-[11px] text-warn">Enter your name above to approve or reject.</p>}
          {error && <p role="alert" className="text-[13px] text-bad">{error}</p>}
        </div>
      )}
    </li>
  );
}
