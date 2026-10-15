// Plain-English one-liners for ledger entries, so a non-technical reader can follow the
// audit trail. Derived purely from the entry itself (actor, action, payload).
import { formatPence } from "../money";

const MAX_CHARS = 220;

type Payload = Record<string, unknown>;

const str = (p: Payload, k: string): string | null => (typeof p[k] === "string" ? (p[k] as string) : null);
const num = (p: Payload, k: string): number | null => (typeof p[k] === "number" ? (p[k] as number) : null);
const obj = (p: Payload, k: string): Payload => (p[k] && typeof p[k] === "object" ? (p[k] as Payload) : {});
const arr = (p: Payload, k: string): unknown[] => (Array.isArray(p[k]) ? (p[k] as unknown[]) : []);
const human = (s: string) => s.replace(/_/g, " ");
const money = (pence: number | null) => (pence === null ? "an unknown amount" : formatPence(pence));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "agent:evidence" → "Evidence agent", "human:Megan Hughes" → "Megan Hughes", "system:intake" → "Intake". */
export function actorName(actor: string): string {
  const [kind, name = ""] = actor.split(/:(.*)/s);
  if (kind === "agent") return `${cap(name)} agent`;
  if (kind === "human") return name || "Someone";
  return cap(human(name || kind));
}

function describeCompleted(agent: string, output: Payload): string {
  switch (agent) {
    case "evidence": {
      const facts = obj(output, "facts");
      return `Evidence agent finished: ${plural(arr(output, "items").length, "document")} reviewed, ${plural(arr(facts, "disputes").length, "debtor complaint")} found, ${plural(arr(output, "gaps").length, "evidence gap")}.`;
    }
    case "reconciliation":
      return `Reconciliation finished: ${money(num(output, "supportedPrincipalPence"))} is supported by the evidence, ${num(output, "daysOverdue") ?? 0} days overdue.`;
    case "challenge": {
      const confidence = num(output, "confidence");
      return `Challenge finished: ${money(num(output, "defensiblePrincipalPence"))} is defensible${confidence === null ? "" : ` at ${Math.round(confidence * 100)}% confidence`}. Recommends: ${human(str(output, "recommendation") ?? "review")}.`;
    }
    case "resolution":
      return `Resolution finished: ${plural(arr(output, "proposals").length, "action")} drafted for human approval.`;
    default:
      return `${cap(agent)} agent finished.`;
  }
}

function describeAgentAction(agent: string, step: string, p: Payload): string | null {
  const who = `${cap(agent)} agent`;
  switch (step) {
    case "completed":
      return describeCompleted(agent, obj(p, "output"));
    case "failed":
      return `${who} failed (attempt ${num(p, "attempt") ?? "?"}): ${str(p, "error") ?? "unknown error"}.`;
    case "claude_fallback":
      return `Claude was unavailable, so the ${who.toLowerCase()} used the rules engine instead.`;
    case "started":
      if (agent === "evidence") return `Evidence agent started reviewing ${plural(num(p, "documentCount") ?? 0, "document")}.`;
      if (agent === "reconciliation") return `Reconciliation started checking ${plural(num(p, "invoices") ?? 0, "invoice")} against the contract and deliveries.`;
      if (agent === "challenge") return `Challenge agent started arguing the debtor's side (${plural(num(p, "disputes") ?? 0, "complaint")} on file).`;
      if (agent === "resolution") return `Resolution agent started drafting (strategy: ${human(str(p, "recommendation") ?? "review")}).`;
      return `${who} started.`;
    case "facts_extracted": {
      const title = str(p, "title") ?? "document";
      if (str(p, "source") !== "claude") return `Couldn't read figures from “${title}”; it is not counted in the reconciliation.`;
      const lines = num(p, "lines") ?? 0;
      const total = num(p, "totalPence") ?? num(p, "amountPence");
      const rejected = num(p, "rejected") ?? 0;
      return `Read “${title}” with Claude: ${plural(lines, "line")}${total === null ? "" : `, ${formatPence(total)}`}. Every figure checked against the document${rejected ? `; ${plural(rejected, "figure")} not found there were discarded` : ""}.`;
    }
    case "document_reviewed":
      return `Reviewed “${str(p, "title") ?? "document"}” (${human(str(p, "kind") ?? "document")}) and recorded its fingerprint.`;
    case "line_checked": {
      const flags = arr(p, "flags").filter((f): f is string => typeof f === "string");
      return `Checked “${str(p, "item") ?? "line"}”: ${money(num(p, "invoicedPence"))} invoiced, ${money(num(p, "supportedPence"))} supported${flags.length ? `. Flagged: ${flags.join("; ")}` : ""}.`;
    }
    case "raised": {
      const impact = num(p, "impactPence") ?? 0;
      return `Raised “${str(p, "title") ?? "challenge"}”: ${human(str(p, "verdict") ?? "assessed")}${impact > 0 ? `, deducting ${formatPence(impact)}` : ""}.`;
    }
    case "document_drafted":
      return `Drafted for approval: ${str(p, "title") ?? human(str(p, "kind") ?? "document")}.`;
    default:
      return null;
  }
}

function describeOther(actor: string, action: string, p: Payload): string | null {
  switch (action) {
    case "case.opened":
      return `Case ${str(p, "reference") ?? ""} opened with ${plural(num(p, "documents") ?? 0, "document")}, claiming ${money(num(p, "claimedAmountPence"))}.`.replace("Case  ", "Case ");
    case "run.requested":
      return `${actorName(actor)} started the agent pipeline.`;
    case "run.awaiting_approval":
      return `All agents finished. ${plural(arr(p, "proposals").length, "drafted action")} now wait for a human decision.`;
    case "approval.granted":
    case "approval.rejected": {
      const note = str(p, "note");
      const verb = action === "approval.granted" ? "approved" : "rejected";
      return `${actorName(actor)} ${verb}: ${human(str(p, "kind") ?? "action")} (${money(num(p, "amountPence"))})${note ? `. Note: “${note}”` : ""}.`;
    }
    case "action.executed":
      return str(p, "result") ?? "Approved action executed.";
    case "run.completed":
      return `Run closed: ${num(p, "executed") ?? 0} executed, ${num(p, "rejected") ?? 0} rejected.`;
    case "run.failed":
      return `Run stopped after repeated failures: ${str(p, "error") ?? "unknown error"}.`;
    case "eval.completed":
      return `Agent eval scored ${num(p, "score") ?? "?"}% (optimisation ${num(p, "optimisation") ?? "?"}%, efficiency ${num(p, "efficiency") ?? "?"}%, ${str(p, "checks") ?? "?"} checks).`;
    default:
      return null;
  }
}

export function describeEntry(entry: { actor: string; action: string; payload: unknown }): string {
  const p = entry.payload && typeof entry.payload === "object" ? (entry.payload as Payload) : {};
  const [scope, step = ""] = entry.action.split(".", 2);
  const agentLine = entry.actor.startsWith("agent:") ? describeAgentAction(scope, step, p) : null;
  const text = agentLine ?? describeOther(entry.actor, entry.action, p) ?? `${actorName(entry.actor)}: ${human(entry.action.replace(".", " "))}.`;
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;
}
