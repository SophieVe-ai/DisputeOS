// Human-in-the-loop approval gate. Nothing an agent drafts is executed without a
// recorded human decision, and every decision is written to the anchored ledger.
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { nowIso } from "../db";
import { appendEntry } from "../ledger/ledger";
import { formatPence } from "../money";
import { getCase } from "../repo/cases";
import { getProposal, recordDecision, recordExecution } from "../repo/proposals";
import type { Proposal } from "../types";
import { afterDecision, armFollowUp, recordOutbound } from "./engagement";

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
  afterDecision(proposal.runId, proposal.turnId);
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
    case "send_reply":
    case "send_reminder":
      return `“${p.documentTitle}” (${formatPence(p.amountPence)}) queued for delivery to ${to}.`;
    case "accept_offer":
      return `Acceptance of ${formatPence(p.amountPence)} in settlement queued for delivery to ${to}.`;
    case "escalate_court_claim":
      return `Claim pack for ${formatPence(p.amountPence)} filed to the case folder for issue (not submitted to court automatically).`;
    case "close_case":
      return p.amountPence > 0 ? `Case closed as settled (${formatPence(p.amountPence)} received).` : "Case closed.";
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
  const message = recordOutbound(proposal);
  appendEntry({
    caseId: proposal.caseId,
    runId: proposal.runId,
    actor: "system:executor",
    action: "action.executed",
    payload: { proposalId: proposal.id, kind: proposal.kind, result, approvedBy: proposal.decidedBy, messageId: message?.id ?? null },
  });
  armFollowUp(proposal);
  return getProposal(proposal.id)!;
}
