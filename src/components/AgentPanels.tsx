import type { ComponentType, ReactNode } from "react";
import type { ChallengeOutput, EvidenceOutput, ReconciliationOutput, ResolutionOutput } from "@/lib/types";
import { humanise, money, pct } from "./format";
import { StatusBadge } from "./StatusBadge";
import { IconChallenge, IconCheck, IconEvidence, IconReconcile, IconResolution, IconWarning } from "./ui/icons";

function Panel({ index, title, Icon, summary, children }: { index: string; title: string; Icon: ComponentType<{ size?: number }>; summary: string; children: ReactNode }) {
  return (
    <section className="card frame reveal p-5">
      <header className="flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded border border-line-2 text-ink-2"><Icon size={14} /></span>
        <h3 className="text-[14px] font-medium">{title}</h3>
        <span className="ml-auto font-mono text-[10px] tracking-[0.12em] text-ink-3">AGENT {index}</span>
      </header>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{summary}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-l border-line-2 pl-3">
      <div className="label">{label}</div>
      <div className="mt-1.5 text-[20px] font-light tracking-[-0.02em] tabular-nums">{children}</div>
    </div>
  );
}

export function EvidencePanel({ out }: { out: EvidenceOutput }) {
  return (
    <Panel index="01" title="Evidence" Icon={IconEvidence} summary={out.summary}>
      <div className="grid gap-2 md:grid-cols-2">
        {out.items.map((item) => (
          <div key={item.docId} className="rounded border border-line bg-panel-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium">{item.docTitle}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">{humanise(item.kind)} · {item.relevance}</span>
            </div>
            <ul className="mt-2 space-y-1 text-[12px] text-ink-2">
              {item.facts.map((f, i) => <li key={i} className="flex gap-2"><span className="text-ink-3">—</span>{f}</li>)}
            </ul>
          </div>
        ))}
      </div>
      {out.gaps.length > 0 && (
        <div className="mt-4 rounded border border-warn/25 bg-warn/[.03] p-3 text-[13px]">
          <div className="label text-warn">Evidential gaps</div>
          <ul className="mt-2 space-y-1 text-ink-2">
            {out.gaps.map((g, i) => <li key={i} className="flex gap-2"><IconWarning size={14} className="mt-0.5 shrink-0 text-warn" />{g}</li>)}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function ReconciliationPanel({ out }: { out: ReconciliationOutput }) {
  const rows: [string, number, boolean?][] = [
    ["Invoiced", out.invoicedTotalPence],
    ["Less payments received", -out.paidPence],
    ["Less invoiced above contract price", -out.overchargePence],
    ["Less goods not delivered", -out.shortDeliveryPence],
    ["Supported principal", out.supportedPrincipalPence, true],
    [`Statutory interest (${out.daysOverdue} days)`, out.interestPence],
    ["Fixed compensation", out.compensationPence],
    ["Total recoverable (before challenge)", out.totalRecoverablePence, true],
  ];
  return (
    <Panel index="02" title="Reconciliation" Icon={IconReconcile} summary={out.summary}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="text-left">
            <tr>
              {["Item", "Contract", "Invoiced", "Delivered", "Supported", "Flags"].map((h, i) => (
                <th key={h} className={`label py-2 pr-3 font-medium ${i > 0 && i < 5 ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {out.lines.map((l) => (
              <tr key={l.item} className="border-t border-line">
                <td className="py-2 pr-3">{l.item}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-2">{money(l.contractUnitPence)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-2">{l.invoicedQty} × {money(l.invoicedUnitPence)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-2">{l.deliveredQty}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(l.supportedPence)}</td>
                <td className="py-2 text-warn">{l.flags.join("; ") || <span className="inline-flex items-center gap-1 text-good"><IconCheck size={12} /> matches</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-5 grid gap-1.5 text-[13px]">
        {rows.filter(([, v, strong]) => strong || v !== 0).map(([k, v, strong]) => (
          <div key={k} className={`flex justify-between ${strong ? "border-t border-line pt-1.5 font-medium" : "text-ink-2"}`}>
            <dt>{k}</dt><dd className="tabular-nums">{money(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 font-mono text-[10.5px] text-ink-3">Deterministic arithmetic. No LLM touches the numbers.</p>
    </Panel>
  );
}

export function ChallengePanel({ out }: { out: ChallengeOutput }) {
  return (
    <Panel index="03" title="Challenge" Icon={IconChallenge} summary={out.summary}>
      <div className="mb-5 grid grid-cols-3 gap-4">
        <Figure label="Defensible">{money(out.defensiblePrincipalPence)}</Figure>
        <Figure label="Confidence">{pct(out.confidence)}</Figure>
        <Figure label="Recommendation"><span className="text-[14px] capitalize">{humanise(out.recommendation)}</span></Figure>
      </div>
      <ul className="space-y-2">
        {out.challenges.map((c) => (
          <li key={c.id} className="rounded border border-line bg-panel-2 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={c.verdict} />
              <span className="text-[13px] font-medium">{c.title}</span>
              <span className="font-mono text-[10px] text-ink-3">sev {c.severity} · {c.source === "claude" ? "claude" : "rules"}</span>
              {c.impactPence > 0 && <span className="ml-auto text-[13px] tabular-nums text-warn">−{money(c.impactPence)}</span>}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{c.argument}</p>
            <p className="mt-1 text-[12px] leading-relaxed"><span className="text-ink-3">Assessment — </span>{c.rebuttal}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ResolutionSummary({ out }: { out: ResolutionOutput }) {
  return (
    <Panel index="04" title="Resolution" Icon={IconResolution} summary={out.summary}>
      <p className="text-[13px] leading-relaxed text-ink-2">{out.strategy}</p>
    </Panel>
  );
}
