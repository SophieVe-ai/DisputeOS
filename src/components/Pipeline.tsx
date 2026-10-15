import type { ComponentType } from "react";
import type { RunStep } from "@/lib/types";
import { IconChallenge, IconEvidence, IconGate, IconReconcile, IconResolution } from "./ui/icons";

type NodeState = "idle" | "waiting" | "running" | "done" | "failed" | "attention";

const STAGES: { key: string; title: string; blurb: string; Icon: ComponentType<{ size?: number }> }[] = [
  { key: "evidence", title: "Evidence", blurb: "Contract, invoices, deliveries, payments, correspondence", Icon: IconEvidence },
  { key: "reconciliation", title: "Reconciliation", blurb: "Quantities, prices, payments, statutory interest", Icon: IconReconcile },
  { key: "challenge", title: "Challenge", blurb: "Argues the debtor's side against our claim", Icon: IconChallenge },
  { key: "resolution", title: "Resolution", blurb: "Chooses a strategy and drafts documents", Icon: IconResolution },
  { key: "gate", title: "Human approval", blurb: "Nothing executes without a recorded decision", Icon: IconGate },
];

const STATE_LABEL: Record<NodeState, string> = {
  idle: "idle", waiting: "queued", running: "running", done: "complete", failed: "failed", attention: "needs you",
};

function NodeMark({ state, Icon }: { state: NodeState; Icon: ComponentType<{ size?: number }> }) {
  const ring =
    state === "done" ? "var(--ink)" : state === "failed" ? "var(--bad)" : state === "attention" ? "var(--warn)" : state === "running" ? "var(--info)" : "var(--border-2)";
  return (
    <span className="relative grid h-11 w-11 place-items-center">
      <svg viewBox="0 0 44 44" className="absolute inset-0" aria-hidden>
        <circle cx="22" cy="22" r="21" fill="var(--bg)" stroke={ring} strokeOpacity={state === "idle" || state === "waiting" ? 1 : 0.9} />
        {state === "running" && (
          <>
            <circle cx="22" cy="22" r="21" fill="none" stroke="var(--info)" strokeWidth="1.5" strokeDasharray="28 104" strokeLinecap="round" className="spin" />
            <circle cx="22" cy="22" r="21" fill="none" stroke="var(--info)" className="ping" />
          </>
        )}
        {state === "attention" && <circle cx="22" cy="22" r="21" fill="none" stroke="var(--warn)" className="ping" />}
        {state === "done" && <circle cx="22" cy="22" r="17" fill="var(--ink)" className="reveal" />}
      </svg>
      <span className={`relative ${state === "done" ? "text-bg" : state === "running" ? "text-info" : state === "attention" ? "text-warn" : state === "failed" ? "text-bad" : "text-ink-3"}`}>
        {state === "done" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" className="draw" style={{ ["--len" as string]: 24 }} />
          </svg>
        ) : (
          <Icon size={17} />
        )}
      </span>
    </span>
  );
}

function stageStates(steps: RunStep[], runStatus: string | null): NodeState[] {
  const agents = STAGES.slice(0, 4).map(({ key }): NodeState => {
    const step = steps.find((s) => s.agent === key);
    if (!step || !runStatus) return "idle";
    if (step.status === "done") return "done";
    if (step.status === "running") return "running";
    if (step.status === "failed") return "failed";
    return "waiting";
  });
  const gate: NodeState = runStatus === "awaiting_approval" ? "attention" : runStatus === "completed" ? "done" : "idle";
  return [...agents, gate];
}

export function Pipeline({ steps, runStatus }: { steps: RunStep[]; runStatus: string | null }) {
  const states = stageStates(steps, runStatus);
  const doneCount = states.filter((s) => s === "done").length;
  const activeIndex = states.findIndex((s) => s === "running" || s === "attention");
  const progress = Math.min(1, (activeIndex >= 0 ? activeIndex : doneCount === 0 ? 0 : doneCount - 1) / (STAGES.length - 1));

  return (
    <section aria-label="Agent pipeline" className="card frame px-6 pb-6 pt-5">
      <div className="mb-6 flex items-center justify-between">
        <span className="label">Agent pipeline</span>
        <span className="font-mono text-[10.5px] tabular-nums text-ink-3">{doneCount}/{STAGES.length} stages</span>
      </div>
      <ol className="relative grid grid-cols-1 gap-6 md:grid-cols-5 md:gap-4">
        {/* Rail behind the nodes; fills with progress, shimmers ahead of the active node. */}
        <li role="presentation" aria-hidden className="pointer-events-none absolute left-[10%] right-[10%] top-[20px] hidden h-[3px] overflow-hidden md:block">
          <div className="absolute inset-x-0 top-px h-px bg-line-2" />
          <div className="absolute left-0 top-px h-px bg-ink transition-[width] duration-1000 ease-[cubic-bezier(.16,1,.3,1)]" style={{ width: `${progress * 100}%` }} />
          {activeIndex >= 0 && <div className="beam absolute top-0 h-[3px] opacity-60" style={{ left: `${progress * 100}%`, width: `${100 / (STAGES.length - 1)}%` }} />}
        </li>
        {STAGES.map((stage, i) => {
          const state = states[i];
          const step = steps.find((s) => s.agent === stage.key);
          return (
            <li key={stage.key} className="relative flex gap-4 md:flex-col md:items-center md:gap-3 md:text-center">
              <NodeMark state={state} Icon={stage.Icon} />
              <div className="min-w-0">
                <div className="font-mono text-[10px] tracking-[0.12em] text-ink-3">{String(i + 1).padStart(2, "0")}</div>
                <div className="mt-0.5 text-[14px] font-medium tracking-[-0.01em]">{stage.title}</div>
                <p className="mt-1 text-[12px] leading-snug text-ink-3 md:mx-auto md:max-w-[15rem]">{stage.blurb}</p>
                <div className={`mt-2 font-mono text-[10px] uppercase tracking-[0.1em] ${state === "running" ? "text-info" : state === "attention" ? "text-warn" : state === "failed" ? "text-bad" : state === "done" ? "text-ink-2" : "text-ink-3"}`}>
                  {STATE_LABEL[state]}{step?.engine ? ` · ${step.engine}` : ""}
                </div>
                {step?.error && <p className="mt-1 text-[11px] text-bad">{step.error}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
