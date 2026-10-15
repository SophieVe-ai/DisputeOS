import type { ChallengeOutput, EvidenceOutput, ReconciliationOutput, ResolutionOutput } from "@/lib/types";
import { humanise, money, pct } from "./format";
import { StatusBadge } from "./StatusBadge";

function Panel({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-ink-2">{summary}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EvidencePanel({ out }: { out: EvidenceOutput }) {
  return (
    <Panel title="🔎 Evidence" summary={out.summary}>
      <div className="grid gap-3 md:grid-cols-2">
        {out.items.map((item) => (
          <div key={item.docId} className="rounded-lg border border-line bg-panel-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{item.docTitle}</span>
              <span className="text-[11px] text-ink-3">{humanise(item.kind)} · {item.relevance}</span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-ink-2">
              {item.facts.map((f, i) => <li key={i}>• {f}</li>)}
            </ul>
          </div>
        ))}
      </div>
      {out.gaps.length > 0 && (
        <div className="mt-4 rounded-lg border border-warn/30 p-3 text-sm">
          <div className="label text-warn">Evidential gaps</div>
          <ul className="mt-1 space-y-1 text-ink-2">{out.gaps.map((g, i) => <li key={i}>⚠ {g}</li>)}</ul>
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
    <Panel title="🧮 Reconciliation" summary={out.summary}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-ink-3">
            <tr>
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 pr-3 text-right font-medium">Contract</th>
              <th className="py-2 pr-3 text-right font-medium">Invoiced</th>
              <th className="py-2 pr-3 text-right font-medium">Delivered</th>
              <th className="py-2 pr-3 text-right font-medium">Supported</th>
              <th className="py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {out.lines.map((l) => (
              <tr key={l.item} className="border-t border-line">
                <td className="py-2 pr-3">{l.item}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(l.contractUnitPence)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{l.invoicedQty} × {money(l.invoicedUnitPence)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{l.deliveredQty}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(l.supportedPence)}</td>
                <td className="py-2 text-warn">{l.flags.join("; ") || <span className="text-good">✓ matches</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-4 grid gap-1 text-sm">
        {rows.filter(([, v, strong]) => strong || v !== 0).map(([k, v, strong]) => (
          <div key={k} className={`flex justify-between ${strong ? "border-t border-line pt-1 font-semibold" : "text-ink-2"}`}>
            <dt>{k}</dt><dd className="tabular-nums">{money(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-ink-3">Arithmetic is deterministic by design. No LLM touches the numbers.</p>
    </Panel>
  );
}

export function ChallengePanel({ out }: { out: ChallengeOutput }) {
  return (
    <Panel title="⚔️ Challenge" summary={out.summary}>
      <div className="mb-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg border border-line p-3"><div className="label">Defensible</div><div className="text-xl font-bold tabular-nums">{money(out.defensiblePrincipalPence)}</div></div>
        <div className="rounded-lg border border-line p-3"><div className="label">Confidence</div><div className="text-xl font-bold tabular-nums">{pct(out.confidence)}</div></div>
        <div className="rounded-lg border border-line p-3"><div className="label">Recommendation</div><div className="text-sm font-bold capitalize">{humanise(out.recommendation)}</div></div>
      </div>
      <ul className="space-y-2">
        {out.challenges.map((c) => (
          <li key={c.id} className="rounded-lg border border-line bg-panel-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={c.verdict} />
              <span className="text-sm font-medium">{c.title}</span>
              <span className="text-[11px] text-ink-3">severity {c.severity} · {c.source === "claude" ? "Claude" : "rules"}</span>
              {c.impactPence > 0 && <span className="ml-auto text-sm tabular-nums text-warn">−{money(c.impactPence)}</span>}
            </div>
            <p className="mt-1 text-xs text-ink-2">{c.argument}</p>
            <p className="mt-1 text-xs"><span className="text-ink-3">Assessment: </span>{c.rebuttal}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ResolutionSummary({ out }: { out: ResolutionOutput }) {
  return (
    <Panel title="✍️ Resolution" summary={out.summary}>
      <p className="text-sm text-ink-2">{out.strategy}</p>
    </Panel>
  );
}
