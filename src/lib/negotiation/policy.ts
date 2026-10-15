// Deterministic negotiation policy. Given what the debtor said (or that they said nothing
// before the deadline), decide the next move. Money decisions never go through an LLM:
// the agent never proposes settling below the Challenge agent's defensible principal.
import { daysBetween, formatPence } from "../money";
import type { NegotiationDecision, ProposalKind, ReplyAnalysis, WakeupKind } from "../types";

export const REPLY_WINDOW_DAYS = 14;
export const SHORT_WINDOW_DAYS = 7;
export const PROMISE_GRACE_DAYS = 2;
export const MAX_PROMISE_DAYS = 30;
export const MAX_REMINDERS = 1;
export const MAX_COUNTER_OFFERS = 2;

export interface PolicyInput {
  trigger: WakeupKind;
  analysis: ReplyAnalysis | null;
  /** Lowest figure currently on the table. */
  demandPence: number;
  /** Defensible principal: the settlement floor. */
  floorPence: number;
  remindersSent: number;
  counterOffersMade: number;
  /** Dispute types the Challenge agent has already assessed (and priced into our figures). */
  assessedDisputeTypes: readonly string[];
  asOf: string;
}

export interface PolicyAction {
  kind: ProposalKind;
  amountPence: number;
  followUpDays: number | null;
}

export interface PolicyResult {
  decision: NegotiationDecision;
  rationale: string;
  action: PolicyAction | null;
}

const act = (decision: NegotiationDecision, rationale: string, kind: ProposalKind, amountPence: number, followUpDays: number | null): PolicyResult => ({
  decision,
  rationale,
  action: { kind, amountPence, followUpDays },
});

function onSilence(input: PolicyInput): PolicyResult {
  if (input.remindersSent < MAX_REMINDERS) {
    return act("remind", `No payment or reply by the deadline. Send one final reminder giving ${SHORT_WINDOW_DAYS} days before issuing proceedings.`, "send_reminder", input.demandPence, SHORT_WINDOW_DAYS);
  }
  if (input.floorPence <= 0) {
    return act("close_settled", "No reply after a final reminder and nothing defensible left to pursue. Close the case.", "close_case", 0, null);
  }
  return act("escalate", `No reply after a letter before action and a final reminder. The pre-action steps are complete, so the claim for ${formatPence(input.demandPence)} can be issued.`, "escalate_court_claim", input.demandPence, null);
}

function onPaid(input: PolicyInput, a: ReplyAnalysis): PolicyResult {
  if (a.amountPence === null) {
    return act("request_remittance", "The debtor says they have paid but gives no amount. Ask for remittance details so the payment can be matched.", "send_reply", input.demandPence, SHORT_WINDOW_DAYS);
  }
  if (a.amountPence >= input.demandPence) {
    return act("close_settled", `The debtor reports paying ${formatPence(a.amountPence)}, which covers the ${formatPence(input.demandPence)} on the table. Check the bank statement before approving.`, "close_case", a.amountPence, null);
  }
  const balance = input.demandPence - a.amountPence;
  return act("chase_balance", `A part payment of ${formatPence(a.amountPence)} leaves ${formatPence(balance)} outstanding. Acknowledge it and ask for the balance.`, "send_reply", balance, REPLY_WINDOW_DAYS);
}

function onCounterOffer(input: PolicyInput, a: ReplyAnalysis): PolicyResult {
  if (a.amountPence === null) {
    return act("hold_and_review", "The debtor wants to settle but names no figure. Ask them to state their offer.", "send_reply", input.demandPence, SHORT_WINDOW_DAYS);
  }
  if (a.amountPence >= input.floorPence) {
    return act("accept_offer", `${formatPence(a.amountPence)} is at or above the defensible principal of ${formatPence(input.floorPence)}. Accepting costs only interest and compensation, which is cheaper than litigation.`, "accept_offer", a.amountPence, REPLY_WINDOW_DAYS);
  }
  if (input.counterOffersMade >= MAX_COUNTER_OFFERS) {
    return act("escalate", `A third offer below the defensible principal (${formatPence(a.amountPence)} against ${formatPence(input.floorPence)}). Negotiation has stalled, so escalate.`, "escalate_court_claim", input.demandPence, null);
  }
  return act("counter_offer", `${formatPence(a.amountPence)} is below the defensible principal of ${formatPence(input.floorPence)}. Counter at the principal, waiving interest and compensation for prompt payment.`, "offer_settlement", input.floorPence, REPLY_WINDOW_DAYS);
}

function onPromise(input: PolicyInput, a: ReplyAnalysis): PolicyResult {
  if (a.promisedDate === null) {
    return act("ask_for_date", "The debtor will pay but gives no date. Ask for a firm date within 7 days.", "send_reply", input.demandPence, SHORT_WINDOW_DAYS);
  }
  const days = daysBetween(input.asOf, a.promisedDate);
  if (days > MAX_PROMISE_DAYS) {
    return act("ask_for_date", `The promised date (${a.promisedDate}) is ${days} days away, beyond the ${MAX_PROMISE_DAYS} days we accept. Ask for an earlier date or a payment plan.`, "send_reply", input.demandPence, SHORT_WINDOW_DAYS);
  }
  return act("confirm_promise", `The debtor promises payment by ${a.promisedDate}. Confirm in writing and check again ${PROMISE_GRACE_DAYS} days after that date.`, "send_reply", input.demandPence, Math.max(1, days + PROMISE_GRACE_DAYS));
}

function onDispute(input: PolicyInput, a: ReplyAnalysis): PolicyResult {
  const fresh = a.disputeTypes.filter((t) => !input.assessedDisputeTypes.includes(t));
  if (fresh.length > 0 || a.disputeTypes.length === 0) {
    return act("hold_and_review", `The debtor raises a point the Challenge agent has not assessed (${fresh.join(", ") || "unspecified"}). Send a holding reply and review it; consider re-running the agents with this reply added to the case file.`, "send_reply", input.demandPence, SHORT_WINDOW_DAYS);
  }
  return act("rebut_dispute", `The points raised (${a.disputeTypes.join(", ")}) were already assessed by the Challenge agent and are reflected in our figures. Respond with the findings and maintain the demand.`, "send_reply", input.demandPence, REPLY_WINDOW_DAYS);
}

export function decideNextMove(input: PolicyInput): PolicyResult {
  const a = input.analysis;
  if (input.trigger === "deadline" || a === null) return onSilence(input);
  switch (a.intent) {
    case "paid":
      return onPaid(input, a);
    case "counter_offer":
      return onCounterOffer(input, a);
    case "promise_to_pay":
      return onPromise(input, a);
    case "dispute":
      return onDispute(input, a);
    case "refusal":
      return input.floorPence > 0
        ? act("escalate", "The debtor refuses to pay without giving a reason we have not already answered. Escalate to a claim.", "escalate_court_claim", input.demandPence, null)
        : act("close_settled", "The debtor refuses and nothing defensible remains. Close the case.", "close_case", 0, null);
    case "request_info":
      return act("send_evidence", "The debtor asks for supporting documents. Send them and restate the deadline.", "send_reply", input.demandPence, REPLY_WINDOW_DAYS);
    case "acknowledgement":
      return { decision: "wait", rationale: "A holding reply with nothing to act on. Keep the existing deadline.", action: null };
  }
}
