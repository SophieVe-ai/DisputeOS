"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Proposal } from "@/lib/types";
import { api, useApproverName } from "./api";
import { humanise, money, time } from "./format";
import { StatusBadge } from "./StatusBadge";

export function ApprovalGate({ proposals, pinRequired, onDecided }: { proposals: Proposal[]; pinRequired: boolean; onDecided: () => void }) {
  const [approver, setApprover] = useApproverName();
  const [pin, setPin] = useState("");
  const [open, setOpen] = useState<string | null>(proposals[0]?.id ?? null);

  return (
    <section className="card p-5" aria-labelledby="gate-title">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h3 id="gate-title" className="font-semibold">🛡️ Approval gate</h3>
          <p className="text-sm text-ink-2">Agents have drafted these actions. Nothing is sent until a named person approves it, and each decision is recorded on-chain.</p>
        </div>
        <label className="ml-auto block w-48">
          <span className="label">Approver name</span>
          <input className="input mt-1" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="e.g. Megan Hughes" />
        </label>
        {pinRequired && (
          <label className="block w-28">
            <span className="label">PIN</span>
            <input className="input mt-1" type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
          </label>
        )}
      </div>
      <ul className="mt-4 space-y-3">
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
    <li className="rounded-xl border border-line bg-panel-2">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full flex-wrap items-center gap-3 p-4 text-left">
        <StatusBadge status={p.status} />
        <span className="font-medium">{p.title}</span>
        <span className="text-xs text-ink-3">{humanise(p.kind)}</span>
        <span className="ml-auto font-semibold tabular-nums">{money(p.amountPence)}</span>
      </button>
      {expanded && (
        <div className="space-y-4 border-t border-line p-4">
          <p className="text-sm text-ink-2"><span className="text-ink-3">Why: </span>{p.rationale}</p>
          <article className="prose-doc max-h-[28rem] overflow-auto rounded-lg bg-white p-6 text-sm text-gray-900 shadow-inner">
            <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={["img"]} unwrapDisallowed>{p.documentBody}</ReactMarkdown>
          </article>
          {p.status === "pending" ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="block flex-1">
                <span className="label">Note (optional)</span>
                <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </label>
              <button type="button" className="btn btn-bad" disabled={busy || approver.trim().length < 2} onClick={() => decide("reject")}>Reject</button>
              <button type="button" className="btn btn-good" disabled={busy || approver.trim().length < 2} onClick={() => decide("approve")}>Approve &amp; execute</button>
            </div>
          ) : (
            <p className="text-sm text-ink-2">
              {p.status === "rejected" ? "Rejected" : "Approved"} by <strong>{p.decidedBy}</strong> at {time(p.decidedAt)}{p.decisionNote ? ` — “${p.decisionNote}”` : ""}.
              {p.executionResult && <><br /><span className="text-good">✓ {p.executionResult}</span></>}
            </p>
          )}
          {approver.trim().length < 2 && p.status === "pending" && <p className="text-xs text-warn">Enter your name above to approve or reject.</p>}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        </div>
      )}
    </li>
  );
}
