"use client";
import { useState } from "react";
import { DOC_KINDS, type DocKind } from "@/lib/types";
import { humanise } from "../format";
import { IconCheck, IconPlay, IconX } from "../ui/icons";
import type { InferredCase, PreviewDocument } from "./types";

export interface CaseDraft {
  title: string;
  creditor: string;
  debtor: string;
  debtorEmail: string;
  claimed: string;
  summary: string;
}

export const draftFrom = (inferred: InferredCase): CaseDraft => ({
  title: inferred.title,
  creditor: inferred.creditor,
  debtor: inferred.debtor,
  debtorEmail: inferred.debtorEmail ?? "",
  claimed: inferred.claimedAmountPence ? (inferred.claimedAmountPence / 100).toFixed(2) : "",
  summary: inferred.summary,
});

function Confidence({ value }: { value: number }) {
  const tone = value >= 0.8 ? "bg-good" : value >= 0.6 ? "bg-ink-2" : "bg-warn";
  return (
    <span className="flex items-center gap-2" title={`Classifier confidence ${Math.round(value * 100)}%`}>
      <span className="h-1 w-14 overflow-hidden rounded-full bg-line-2">
        <span className={`block h-full origin-left ${tone} transition-transform duration-700`} style={{ transform: `scaleX(${value})` }} />
      </span>
      <span className="font-mono text-[10px] tabular-nums text-ink-3">{Math.round(value * 100)}%</span>
    </span>
  );
}

function DocRow({ doc, index, onChange, onRemove }: { doc: PreviewDocument; index: number; onChange: (patch: Partial<PreviewDocument>) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="reveal rounded border border-line bg-panel-2" style={{ animationDelay: `${index * 50}ms` }}>
      <div className="grid items-center gap-3 px-3 py-2.5 md:grid-cols-[1.4rem_10rem_1fr_9.5rem_auto_auto]">
        <IconCheck size={14} className="hidden text-good md:block" />
        <select aria-label={`Type of ${doc.filename}`} className="input h-9 py-1.5 leading-tight" value={doc.kind} onChange={(e) => onChange({ kind: e.target.value as DocKind })}>
          {DOC_KINDS.map((k) => <option key={k} value={k}>{humanise(k)}</option>)}
        </select>
        <div className="min-w-0">
          <input aria-label={`Title of ${doc.filename}`} className="input h-9 py-1.5" value={doc.title} onChange={(e) => onChange({ title: e.target.value })} />
          <button type="button" onClick={() => setOpen(!open)} className="mt-1 truncate font-mono text-[10.5px] text-ink-3 hover:text-ink-2" aria-expanded={open}>
            {doc.filename}{doc.truncated ? " · truncated" : ""} · {open ? "hide text" : "view text"}
          </button>
        </div>
        <input aria-label={`Date of ${doc.filename}`} type="date" className="input h-9 py-1.5" value={doc.docDate ?? ""} onChange={(e) => onChange({ docDate: e.target.value || null })} />
        <Confidence value={doc.confidence} />
        <button type="button" className="btn btn-bad h-8 px-2.5" onClick={onRemove} aria-label={`Remove ${doc.filename}`}><IconX size={13} /></button>
      </div>
      {open && <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-line px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">{doc.content}</pre>}
    </li>
  );
}

export function ReviewPanel({
  docs, draft, onDraft, onDoc, onRemove, onReset, onSubmit, submitting, progress,
}: {
  docs: PreviewDocument[];
  draft: CaseDraft;
  onDraft: (d: CaseDraft) => void;
  onDoc: (i: number, patch: Partial<PreviewDocument>) => void;
  onRemove: (i: number) => void;
  onReset: () => void;
  onSubmit: () => void;
  submitting: boolean;
  progress: string | null;
}) {
  const field = (key: keyof CaseDraft, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input mt-1.5" value={draft[key]} onChange={(e) => onDraft({ ...draft, [key]: e.target.value })} {...props} />
    </label>
  );
  const counts = DOC_KINDS.map((k) => [k, docs.filter((d) => d.kind === k).length] as const).filter(([, n]) => n > 0);

  return (
    <div className="space-y-6">
      <section className="card frame reveal p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium">Case details <span className="ml-2 font-mono text-[10.5px] font-normal text-ink-3">inferred from your documents · edit anything</span></h2>
          <div className="flex flex-wrap gap-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
            {counts.map(([k, n]) => <span key={k}>{n} {humanise(k)}</span>)}
          </div>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {field("title", "Case title", { required: true, minLength: 3 })}
          {field("claimed", "Amount claimed (£)", { required: true, inputMode: "decimal" })}
          {field("creditor", "Creditor (you)", { required: true })}
          {field("debtor", "Debtor", { required: true })}
          {field("debtorEmail", "Debtor email", { type: "email" })}
          {field("summary", "Summary")}
        </div>
      </section>

      <section className="reveal" style={{ animationDelay: "120ms" }}>
        <h2 className="mb-3 text-[15px] font-medium">Documents <span className="ml-2 font-mono text-[10.5px] font-normal text-ink-3">{docs.length} classified</span></h2>
        <ul className="space-y-2">
          {docs.map((d, i) => <DocRow key={`${d.filename}-${i}`} doc={d} index={i} onChange={(p) => onDoc(i, p)} onRemove={() => onRemove(i)} />)}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <button type="button" className="btn btn-primary h-10 px-5" disabled={submitting || docs.length === 0} onClick={onSubmit}>
          {submitting ? (
            <svg width="12" height="12" viewBox="0 0 12 12" className="spin" aria-hidden><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.5" /><path d="M6 1a5 5 0 0 1 5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          ) : <IconPlay size={12} />}
          {submitting ? progress ?? "Working…" : "Create case & run agents"}
        </button>
        <button type="button" className="btn btn-ghost h-10" disabled={submitting} onClick={onReset}>Start over</button>
        <p className="font-mono text-[11px] text-ink-3">Opening the case and starting the run are both written to the on-chain ledger.</p>
      </div>
    </div>
  );
}
