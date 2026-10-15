"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/api";
import { DOC_KINDS, type DocKind } from "@/lib/types";

interface DraftDoc { kind: DocKind; title: string; content: string; docDate: string }

const TEMPLATES: Record<DocKind, string> = {
  contract: "Contract reference: \nContract date: 2026-01-31\nPayment terms: 30 days from invoice\nInspection period: 5 working days from delivery\n- Item name | qty 10 | £100.00 per unit",
  invoice: "Invoice number: \nInvoice date: 2026-02-01\nDue date: 2026-03-03\n- Item name | qty 10 | £100.00\nTotal due: £1,000.00",
  delivery_note: "Delivery date: 2026-01-31\n- Item name | qty 10\nSigned by: ",
  payment: "Payment date: \nAmount paid: £\nReference: ",
  correspondence: "From: Name (Company)\nDate: 2026-02-10\n\nMessage text…",
  other: "",
};

const emptyDoc = (kind: DocKind): DraftDoc => ({ kind, title: "", content: TEMPLATES[kind], docDate: "" });

export default function NewCasePage() {
  const router = useRouter();
  const [form, setForm] = useState({ title: "", creditor: "", debtor: "", debtorEmail: "", claimed: "", summary: "" });
  const [docs, setDocs] = useState<DraftDoc[]>([emptyDoc("contract"), emptyDoc("invoice"), emptyDoc("delivery_note")]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setDoc = (i: number, patch: Partial<DraftDoc>) => setDocs(docs.map((d, n) => (n === i ? { ...d, ...patch } : d)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const claimed = Math.round(Number(form.claimed.replace(/[£,]/g, "")) * 100);
    if (!Number.isFinite(claimed) || claimed <= 0) return setError("Enter the amount claimed in pounds.");
    setBusy(true);
    try {
      const created = await api<{ id: string }>("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          creditor: form.creditor,
          debtor: form.debtor,
          debtorEmail: form.debtorEmail || null,
          claimedAmountPence: claimed,
          summary: form.summary,
          documents: docs.filter((d) => d.content.trim()).map((d) => ({ ...d, title: d.title || d.kind, docDate: d.docDate || null })),
        }),
      });
      router.push(`/cases/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input mt-1" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-6">
      <h1 className="text-2xl font-bold">Open a new dispute</h1>
      <section className="card grid gap-4 p-5 md:grid-cols-2">
        {field("title", "Case title", { required: true, minLength: 3 })}
        {field("claimed", "Amount claimed (£)", { required: true, inputMode: "decimal", placeholder: "12,920.00" })}
        {field("creditor", "Your company (creditor)", { required: true })}
        {field("debtor", "Debtor company", { required: true })}
        {field("debtorEmail", "Debtor accounts email", { type: "email" })}
        {field("summary", "Short summary")}
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Documents</h2>
          <div className="flex gap-2">
            {DOC_KINDS.filter((k) => k !== "other").map((k) => (
              <button key={k} type="button" className="btn btn-ghost text-xs" onClick={() => setDocs([...docs, emptyDoc(k)])}>+ {k.replace("_", " ")}</button>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-3">Use one line per item, in the form <code>- Item | qty N | £price</code>. With an Anthropic API key, the Evidence agent also reads free-text correspondence.</p>
        {docs.map((d, i) => (
          <div key={i} className="card grid gap-3 p-4 md:grid-cols-[10rem_1fr_9rem_auto]">
            <select aria-label="Document type" className="input" value={d.kind} onChange={(e) => setDoc(i, { kind: e.target.value as DocKind })}>
              {DOC_KINDS.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
            </select>
            <input aria-label="Document title" className="input" placeholder="Title" value={d.title} onChange={(e) => setDoc(i, { title: e.target.value })} />
            <input aria-label="Document date" className="input" type="date" value={d.docDate} onChange={(e) => setDoc(i, { docDate: e.target.value })} />
            <button type="button" className="btn btn-bad" onClick={() => setDocs(docs.filter((_, n) => n !== i))} aria-label="Remove document">✕</button>
            <textarea aria-label="Document content" className="input font-mono text-xs md:col-span-4" rows={6} value={d.content} onChange={(e) => setDoc(i, { content: e.target.value })} />
          </div>
        ))}
      </section>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create case"}</button>
    </form>
  );
}
