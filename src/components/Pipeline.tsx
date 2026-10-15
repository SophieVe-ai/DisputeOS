import type { RunStep } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

const META: Record<string, { title: string; blurb: string; icon: string }> = {
  evidence: { title: "Evidence", blurb: "Finds contract, invoices, deliveries, payments, correspondence", icon: "🔎" },
  reconciliation: { title: "Reconciliation", blurb: "Checks quantities, prices, payments, interest", icon: "🧮" },
  challenge: { title: "Challenge", blurb: "Argues the debtor's side against our claim", icon: "⚔️" },
  resolution: { title: "Resolution", blurb: "Chooses strategy, drafts documents", icon: "✍️" },
};

export function Pipeline({ steps, runStatus }: { steps: RunStep[]; runStatus: string | null }) {
  const gate = runStatus === "awaiting_approval" ? "pending" : runStatus === "completed" ? "done" : "idle";
  return (
    <ol className="grid gap-3 md:grid-cols-5" aria-label="Agent pipeline">
      {Object.keys(META).map((agent, i) => {
        const step = steps.find((s) => s.agent === agent);
        const status = step?.status ?? "pending";
        const active = status === "running";
        return (
          <li key={agent} className={`card p-4 ${active ? "border-accent pulse" : ""}`}>
            <div className="flex items-center justify-between">
              <span className="text-lg" aria-hidden>{META[agent].icon}</span>
              {step ? <StatusBadge status={status === "pending" && !runStatus ? "open" : status} label={status === "pending" ? "waiting" : status} /> : <StatusBadge status="open" label="idle" />}
            </div>
            <div className="mt-2 font-semibold">{i + 1}. {META[agent].title}</div>
            <p className="mt-1 text-xs text-ink-3">{META[agent].blurb}</p>
            {step?.engine && <p className="mt-2 text-[11px] text-ink-2">engine: {step.engine}</p>}
            {step?.error && <p className="mt-2 text-[11px] text-bad">{step.error}</p>}
          </li>
        );
      })}
      <li className={`card p-4 ${gate === "pending" ? "border-warn" : ""}`}>
        <div className="flex items-center justify-between">
          <span className="text-lg" aria-hidden>🛡️</span>
          <StatusBadge status={gate === "pending" ? "awaiting_approval" : gate === "done" ? "completed" : "open"} label={gate === "pending" ? "needs you" : gate === "done" ? "decided" : "idle"} />
        </div>
        <div className="mt-2 font-semibold">5. Human approval</div>
        <p className="mt-1 text-xs text-ink-3">No action executes without a recorded human decision</p>
      </li>
    </ol>
  );
}
