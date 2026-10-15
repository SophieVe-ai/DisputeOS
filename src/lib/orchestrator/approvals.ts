// Human-in-the-loop approval gate. Nothing an agent drafts is executed without a
// recorded human decision, and every decision is written to the anchored ledger.
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { nowIso } from "../db";
import { appendEntry } from "../ledger/ledger";
import { formatPence } from "../money";
import { getCase, setCaseStatus } from "../repo/cases";
import { getProposal, listProposals, recordDecision, recordExecution } from "../repo/proposals";
import { getRun, updateRun } from "../repo/runs";
import type { Proposal } from "../types";

export class ApprovalRequiredError extends Error {}
export class DecisionError extends Error {}
export class ForbiddenError extends Error {}

export interface DecisionInput {
  proposalId: string;
  decision: "approve" | "reject";
  approver: string;
  note: string | null;
  pin: string | null;
}

function pinMatches(given: string | null): boolean {
  const expected = config.approvalPin;
  if (!expected) return true;
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decideProposal(input: DecisionInput): Proposal {
  if (!pinMatches(input.pin)) throw new ForbiddenError("Invalid approval PIN");
  const proposal = getProposal(input.proposalId);
  if (!proposal) throw new DecisionError("Proposal not found");
  if (proposal.status !== "pending") throw new DecisionError(`Proposal already ${proposal.status}`);
  const status = input.decision === "approve" ? "approved" : "rejected";
  recordDecision(proposal.id, status, input.approver, input.note, nowIso());
  appendEntry({
    caseId: proposal.caseId,
    runId: proposal.runId,
    actor: `human:${input.approver}`,
    action: status === "approved" ? "approval.granted" : "approval.rejected",
    payload: { proposalId: proposal.id, kind: proposal.kind, amountPence: proposal.amountPence, note: input.note },
  });
  if (status === "approved") executeProposal(proposal.id);
  closeRunIfDecided(proposal.runId);
  return getProposal(proposal.id)!;
}

function dispatchDescription(p: Proposal, debtorEmail: string | null): string {
  const to = debtorEmail ?? "the debtor's registered address";
  switch (p.kind) {
    case "send_letter_before_action":
      return `Letter before action (${formatPence(p.amountPence)}) queued for delivery to ${to}.`;
    case "offer_settlement":
      return `Settlement offer (${formatPence(p.amountPence)}) queued for delivery to ${to}.`;
    case "issue_credit_note":
      return `Credit note for ${formatPence(p.amountPence)} posted to the sales ledger and queued to ${to}.`;
    case "prepare_court_claim":
      return "Money Claim Online pack generated and filed to the case folder (not submitted to court).";
    case "write_off":
      return `Balance of ${formatPence(p.amountPence)} flagged for write-off in the sales ledger.`;
  }
}

/** Executes an approved proposal. Throws if no human approval has been recorded. */
export function executeProposal(proposalId: string): Proposal {
  const proposal = getProposal(proposalId);
  if (!proposal) throw new DecisionError("Proposal not found");
  if (proposal.status !== "approved") {
    throw new ApprovalRequiredError(`Proposal ${proposalId} is ${proposal.status}; human approval is required before execution`);
  }
  const caseFile = getCase(proposal.caseId);
  const result = dispatchDescription(proposal, caseFile?.debtorEmail ?? null);
  recordExecution(proposal.id, result, nowIso());
  appendEntry({
    caseId: proposal.caseId,
    runId: proposal.runId,
    actor: "system:executor",
    action: "action.executed",
    payload: { proposalId: proposal.id, kind: proposal.kind, result, approvedBy: proposal.decidedBy },
  });
  return getProposal(proposal.id)!;
}

function closeRunIfDecided(runId: string): void {
  const run = getRun(runId);
  if (!run || run.status !== "awaiting_approval") return;
  const proposals = listProposals(runId);
  if (proposals.some((p) => p.status === "pending")) return;
  const executed = proposals.filter((p) => p.status === "executed").length;
  updateRun(runId, { status: "completed", completedAt: nowIso() });
  setCaseStatus(run.caseId, executed > 0 ? "resolved" : "open");
  appendEntry({ caseId: run.caseId, runId, actor: "system:orchestrator", action: "run.completed", payload: { executed, rejected: proposals.length - executed } });
}
