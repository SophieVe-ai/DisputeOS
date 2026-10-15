// Long-running engagement: after a letter is sent the run sleeps in `awaiting_response`.
// It wakes when the debtor replies (recordReply) or when a follow-up deadline passes, runs
// one Negotiation agent turn, and goes back to the human approval gate. Every transition
// is written to the anchored ledger.
import { config } from "../config";
import { getDb, nowIso } from "../db";
import { appendEntry } from "../ledger/ledger";
import { todayIso } from "../money";
import { negotiationAgent, type NegotiationContext } from "../negotiation/agent";
import { getLlm } from "../agents/llm";
import { SHORT_WINDOW_DAYS } from "../negotiation/policy";
import { getCase, getDocuments, setCaseStatus } from "../repo/cases";
import { countOutbound, getMessage, insertMessage } from "../repo/correspondence";
import { insertProposals, listProposals } from "../repo/proposals";
import { getRun, getSteps, latestRunForCase, updateRun } from "../repo/runs";
import { cancelOpen, cancelScheduled, cancelWakeup, completeWakeup, failWakeup, getWakeup, insertWakeup, nextScheduledWakeup, setWakeupDue } from "../repo/wakeups";
import type {
  CaseStatus,
  Engine,
  NegotiationOutput,
  ChallengeOutput,
  CorrespondenceMessage,
  EvidenceOutput,
  Proposal,
  ProposalKind,
  ReconciliationOutput,
  ResolutionOutput,
  Run,
  Wakeup,
} from "../types";

export class EngagementError extends Error {}

export const MAX_TURN_ATTEMPTS = 3;
const TURN_RETRY_BASE_MS = 2_000;

/** Actions that send something to the debtor (recorded as outbound correspondence). */
const OUTBOUND_KINDS = new Set<ProposalKind>(["send_letter_before_action", "offer_settlement", "issue_credit_note", "send_reply", "send_reminder", "accept_offer"]);
/** Approving one of these ends the engagement. */
const TERMINAL_OUTCOMES: Partial<Record<ProposalKind, CaseStatus>> = { close_case: "resolved", escalate_court_claim: "escalated" };
const ENGAGED_STATUSES = ["awaiting_response", "awaiting_approval"];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const dueIn = (days: number) => new Date(Date.now() + days * config.followUpDayMs).toISOString();

// ---------- Outbound: called by the executor ----------

export function recordOutbound(p: Proposal): CorrespondenceMessage | null {
  if (!OUTBOUND_KINDS.has(p.kind)) return null;
  const caseFile = getCase(p.caseId);
  return insertMessage({ caseId: p.caseId, runId: p.runId, direction: "outbound", sender: caseFile?.creditor ?? "us", subject: p.documentTitle, body: p.documentBody, proposalId: p.id });
}

/** Arms (or re-arms) the follow-up timer: if the debtor stays silent, the agent wakes when it fires. */
export function scheduleFollowUp(run: Pick<Run, "id" | "caseId">, days: number, reason: string): Wakeup {
  const replaced = cancelScheduled(run.id, "deadline");
  const wakeup = insertWakeup({ runId: run.id, caseId: run.caseId, kind: "deadline", reason, dueAt: dueIn(days) });
  appendEntry({ caseId: run.caseId, runId: run.id, actor: "system:scheduler", action: "followup.scheduled", payload: { wakeupId: wakeup.id, dueAt: wakeup.dueAt, days, reason, replaced } });
  return wakeup;
}

export function armFollowUp(p: Proposal): void {
  if (p.followUpDays == null || !OUTBOUND_KINDS.has(p.kind)) return;
  scheduleFollowUp({ id: p.runId, caseId: p.caseId }, p.followUpDays, `no reply to “${p.documentTitle}”`);
}

// ---------- Inbound: a reply from the debtor ----------

export interface ReplyInput {
  from: string;
  subject: string | null;
  body: string;
}

export function recordReply(caseId: string, input: ReplyInput): { message: CorrespondenceMessage; wakeup: Wakeup } {
  const caseFile = getCase(caseId);
  if (!caseFile) throw new EngagementError("Case not found");
  const run = latestRunForCase(caseId);
  if (!run || !ENGAGED_STATUSES.includes(run.status) || countOutbound(run.id) === 0) {
    throw new EngagementError("Nothing has been sent to the debtor yet, so there is no reply to record");
  }
  const message = insertMessage({ caseId, runId: run.id, direction: "inbound", sender: input.from, subject: input.subject ?? `Re: ${caseFile.reference}`, body: input.body });
  const wakeup = insertWakeup({ runId: run.id, caseId, kind: "reply", reason: `reply from ${input.from}`, dueAt: nowIso(), messageId: message.id });
  appendEntry({
    caseId,
    runId: run.id,
    actor: `counterparty:${input.from}`,
    action: "correspondence.received",
    payload: { messageId: message.id, wakeupId: wakeup.id, subject: message.subject, sha256: message.sha256, chars: message.body.length, queued: run.status === "awaiting_approval" },
  });
  return { message, wakeup };
}

// ---------- One Negotiation agent turn ----------

function buildContext(run: Run, wakeup: Wakeup, asOf: string): NegotiationContext {
  const caseFile = getCase(run.caseId);
  if (!caseFile) throw new Error(`Case ${run.caseId} not found`);
  const out = Object.fromEntries(getSteps(run.id).filter((s) => s.status === "done").map((s) => [s.agent, s.output]));
  if (!out.evidence || !out.reconciliation || !out.challenge || !out.resolution) throw new Error("Pipeline outputs missing; cannot negotiate");
  const message = wakeup.messageId ? getMessage(wakeup.messageId) : null;
  const actor = "agent:negotiation";
  return Object.freeze({
    caseFile: Object.freeze({ ...caseFile }),
    documents: Object.freeze(getDocuments(run.caseId).map((d) => Object.freeze(d))),
    prior: Object.freeze({
      evidence: out.evidence as EvidenceOutput,
      reconciliation: out.reconciliation as ReconciliationOutput,
      challenge: out.challenge as ChallengeOutput,
      resolution: out.resolution as ResolutionOutput,
    }),
    executed: Object.freeze(listProposals(run.id).filter((p) => p.status === "executed").map((p) => Object.freeze(p))),
    trigger: Object.freeze({ kind: wakeup.kind, reason: wakeup.reason, message: message ? Object.freeze(message) : null }),
    asOf,
    baseRatePercent: config.boeBaseRatePercent,
    llm: getLlm(),
    log: (action: string, payload?: unknown) => {
      appendEntry({ caseId: run.caseId, runId: run.id, actor, action, payload: payload ?? null });
    },
    pace: (fraction = 1) => sleep(config.stepDelayMs * fraction),
  });
}

/** Runs one leased wake-up. The worker claims it first (status `processing`). */
export async function processWakeup(id: string, asOf: string = todayIso()): Promise<Wakeup> {
  const wakeup = getWakeup(id);
  if (!wakeup) throw new Error(`Wake-up ${id} not found`);
  if (wakeup.status !== "processing") return wakeup;
  const run = getRun(wakeup.runId);
  if (!run || run.status !== "awaiting_response") {
    cancelWakeup(wakeup.id); // the engagement ended while this was queued
    return getWakeup(id)!;
  }
  if (wakeup.attempts >= MAX_TURN_ATTEMPTS) {
    handleTurnFailure(run, wakeup, new Error(`Abandoned after ${wakeup.attempts} expired leases`), true);
    return getWakeup(id)!;
  }
  let result: Awaited<ReturnType<typeof negotiationAgent.run>>;
  try {
    result = await negotiationAgent.run(buildContext(run, wakeup, asOf));
  } catch (err) {
    if (stillOwned(wakeup)) handleTurnFailure(run, wakeup, err);
    return getWakeup(id)!;
  }
  getDb().transaction(() => commitTurn(wakeup, result.output, result.engine))();
  return getWakeup(id)!;
}

/** True while this process still holds the lease it started with (not reclaimed, not cancelled). */
function stillOwned(claimed: Wakeup): boolean {
  const now = getWakeup(claimed.id);
  return now?.status === "processing" && now.leaseUntil === claimed.leaseUntil;
}

/**
 * Applies a finished turn, atomically, only if nothing changed while the agent was thinking:
 * the run must still be waiting on the debtor and the lease must still be ours. Otherwise the
 * result is discarded, so a closed case can never be revived and a turn never lands twice.
 */
function commitTurn(claimed: Wakeup, output: NegotiationOutput, engine: Engine): void {
  const run = getRun(claimed.runId);
  if (!run) return;
  const owned = stillOwned(claimed);
  if (!owned || run.status !== "awaiting_response") {
    if (owned) cancelWakeup(claimed.id);
    appendEntry({ caseId: run.caseId, runId: run.id, actor: "agent:negotiation", action: "negotiation.discarded", payload: { wakeupId: claimed.id, reason: run.status !== "awaiting_response" ? `run is ${run.status}` : "lease lost" } });
    return;
  }
  completeWakeup(claimed.id, engine, output);
  appendEntry({ caseId: run.caseId, runId: run.id, actor: "agent:negotiation", action: "negotiation.completed", payload: { engine, wakeupId: claimed.id, output } });
  if (output.proposals.length === 0) return;
  // The new move supersedes the old timer; approving it arms a fresh one.
  if (claimed.kind === "reply") cancelScheduled(run.id, "deadline");
  const proposals = insertProposals(run.id, run.caseId, output.proposals, claimed.id);
  updateRun(run.id, { status: "awaiting_approval" });
  setCaseStatus(run.caseId, "awaiting_approval");
  appendEntry({
    caseId: run.caseId,
    runId: run.id,
    actor: "system:orchestrator",
    action: "run.awaiting_approval",
    payload: { turnId: claimed.id, proposals: proposals.map((p) => ({ id: p.id, kind: p.kind, amountPence: p.amountPence })) },
  });
}

/** Records a failed attempt; `abandon` fails it outright (attempts were already counted on reclaim). */
function handleTurnFailure(run: Run, wakeup: Wakeup, err: unknown, abandon = false): void {
  const message = err instanceof Error ? err.message : String(err);
  const attempts = abandon ? wakeup.attempts : wakeup.attempts + 1;
  const exhausted = abandon || attempts >= MAX_TURN_ATTEMPTS;
  failWakeup(wakeup.id, attempts, message.slice(0, 500), exhausted ? null : new Date(Date.now() + TURN_RETRY_BASE_MS * 2 ** attempts).toISOString());
  appendEntry({ caseId: run.caseId, runId: run.id, actor: "agent:negotiation", action: "negotiation.failed", payload: { attempt: attempts, error: message, wakeupId: wakeup.id } });
  if (exhausted) ensureFollowUp(run);
}

/** Makes sure a waiting run always has a timer, so an engagement can never stall silently. */
function ensureFollowUp(run: Run): void {
  if (!nextScheduledWakeup(run.id)) scheduleFollowUp(run, SHORT_WINDOW_DAYS, "routine follow-up");
}

// ---------- After the human decides ----------

function awaitResponse(run: Run): void {
  updateRun(run.id, { status: "awaiting_response", leaseUntil: null });
  setCaseStatus(run.caseId, "awaiting_response");
  appendEntry({ caseId: run.caseId, runId: run.id, actor: "system:orchestrator", action: "run.awaiting_response", payload: { nextWakeAt: nextScheduledWakeup(run.id)?.dueAt ?? null } });
}

function finish(run: Run, caseStatus: CaseStatus, payload: Record<string, unknown>): void {
  // Replies still queued are never silently dropped: the ledger records how many went unanswered.
  const unreadReplies = cancelOpen(run.id).filter((w) => w.kind === "reply").length;
  if (unreadReplies > 0) payload = { ...payload, unreadReplies };
  updateRun(run.id, { status: "completed", completedAt: nowIso() });
  setCaseStatus(run.caseId, caseStatus);
  appendEntry({ caseId: run.caseId, runId: run.id, actor: "system:orchestrator", action: "run.completed", payload });
}

/** Called after every decision. Once a batch is fully decided, moves the run on. */
export function afterDecision(runId: string, turnId: string | null): void {
  const run = getRun(runId);
  if (!run || run.status !== "awaiting_approval") return;
  const proposals = listProposals(runId);
  if (proposals.some((p) => p.status === "pending")) return;
  const batch = proposals.filter((p) => p.turnId === turnId);
  const executed = batch.filter((p) => p.status === "executed");
  const counts = { executed: executed.length, rejected: batch.length - executed.length };
  const terminal = executed.find((p) => TERMINAL_OUTCOMES[p.kind]);
  if (terminal) return finish(run, TERMINAL_OUTCOMES[terminal.kind]!, { ...counts, outcome: terminal.kind });
  if (executed.some((p) => p.followUpDays != null && OUTBOUND_KINDS.has(p.kind))) return awaitResponse(run);
  if (turnId === null) return finish(run, executed.length > 0 ? "resolved" : "open", counts);
  ensureFollowUp(run);
  awaitResponse(run);
}

// ---------- Human controls ----------

export function closeEngagement(caseId: string, by: string): Run {
  const run = latestRunForCase(caseId);
  if (!run || run.status !== "awaiting_response") throw new EngagementError("No negotiation is waiting on the debtor (decide any pending actions first)");
  const cancelled = cancelOpen(run.id).length; // includes a turn in flight; its result will be discarded
  updateRun(run.id, { status: "completed", completedAt: nowIso() });
  setCaseStatus(caseId, "closed");
  appendEntry({ caseId, runId: run.id, actor: `human:${by}`, action: "run.closed", payload: { cancelledWakeups: cancelled } });
  return getRun(run.id)!;
}

/** DEMO ONLY: fires the next scheduled follow-up now instead of in N days. Logged, never hidden. */
export function fastForward(caseId: string): Wakeup | null {
  const run = latestRunForCase(caseId);
  if (!run) return null;
  const next = nextScheduledWakeup(run.id, "deadline");
  if (!next) return null;
  setWakeupDue(next.id, nowIso());
  appendEntry({ caseId, runId: run.id, actor: "system:demo-clock", action: "clock.fast_forwarded", payload: { wakeupId: next.id, originalDueAt: next.dueAt } });
  return getWakeup(next.id);
}
