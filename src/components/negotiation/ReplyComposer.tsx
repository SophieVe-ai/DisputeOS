"use client";
import { useState } from "react";
import { addDays, formatPence, todayIso } from "@/lib/money";
import type { DisputeCase } from "@/lib/types";
import { api } from "../api";
import { IconMail } from "../ui/icons";

const MAX_BODY = 20_000;
const LOW_OFFER_RATIO = 0.6;
const PROMISE_DAYS = 10;

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** Sample replies for demos, built from the live figures. Clearly labelled as samples in the UI. */
function samples(c: DisputeCase, demandPence: number | null, floorPence: number | null) {
  const demand = demandPence ?? c.claimedAmountPence;
  const floor = floorPence ?? demand;
  return [
    { label: "Promise to pay", body: `Thank you for your letter. We will pay the outstanding balance of ${formatPence(demand)} by ${longDate(addDays(todayIso(), PROMISE_DAYS))}.` },
    { label: "Low offer", body: `We have reviewed your letter. We are prepared to pay ${formatPence(Math.round((floor * LOW_OFFER_RATIO) / 100) * 100)} in full and final settlement.` },
    { label: "Fair offer", body: `To close this matter we can offer ${formatPence(floor)} in full and final settlement.` },
    { label: "Dispute", body: "We dispute this invoice. Several of the units were damaged on arrival and we will not pay for them." },
    { label: "Says paid", body: `We have paid ${formatPence(demand)} by bank transfer today, reference ${c.reference}.` },
    { label: "Wants proof", body: "Before we consider payment, please send us a copy of the signed proof of delivery and the contract." },
    { label: "Refuses", body: "We will not pay this invoice and reject your claim entirely." },
  ];
}

export function ReplyComposer({ caseFile, demandPence, floorPence, demoMode, onSent }: { caseFile: DisputeCase; demandPence: number | null; floorPence: number | null; demoMode: boolean; onSent: () => void }) {
  const [from, setFrom] = useState(caseFile.debtorEmail ?? caseFile.debtor);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/cases/${caseFile.id}/replies`, { method: "POST", body: JSON.stringify({ from, subject: null, body }) });
      setBody("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-line p-4">
      <div className="flex items-center gap-2">
        <IconMail size={14} className="text-ink-2" />
        <h4 className="text-[13px] font-medium">Log a reply from {caseFile.debtor}</h4>
      </div>
      <p className="mt-1 text-[12px] text-ink-3">Paste the debtor&apos;s email or letter. In production your inbound mailbox posts it to <code className="font-mono">/api/cases/{"{id}"}/replies</code>. Either way the Negotiation agent wakes immediately.</p>
      {demoMode && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Sample replies (demo)</span>
          {samples(caseFile, demandPence, floorPence).map((s) => (
            <button key={s.label} type="button" className="btn btn-ghost px-2 py-1 text-[11px]" onClick={() => setBody(s.body)}>{s.label}</button>
          ))}
        </div>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <label className="block">
          <span className="label">From</span>
          <input className="input mt-1.5" value={from} onChange={(e) => setFrom(e.target.value)} maxLength={120} />
        </label>
        <label className="block">
          <span className="label">Message</span>
          <textarea className="input mt-1.5 min-h-[88px] resize-y" value={body} onChange={(e) => setBody(e.target.value)} maxLength={MAX_BODY} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        {error && <p role="alert" className="text-[12px] text-bad">{error}</p>}
        <button type="button" className="btn btn-primary ml-auto" disabled={busy || body.trim().length === 0 || from.trim().length < 2} onClick={send}>
          Log reply &amp; wake agent
        </button>
      </div>
    </div>
  );
}
