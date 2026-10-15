// Deterministic follow-up correspondence (used directly offline, and as the guard-rail for Claude drafts).
import { addDays, formatPence } from "../money";
import type { CaseDocument, Challenge, DisputeCase, NegotiationDecision, ReplyAnalysis } from "../types";

export interface FollowUpLetterInput {
  caseFile: DisputeCase;
  asOf: string;
  decision: NegotiationDecision;
  amountPence: number;
  followUpDays: number | null;
  analysis: ReplyAnalysis | null;
  demandPence: number;
  floorPence: number;
  challenges: readonly Challenge[];
  documents: readonly Pick<CaseDocument, "title" | "kind">[];
  /** Draft particulars of claim, used when escalating. */
  claimPack: string;
}

export interface FollowUpDocument {
  title: string;
  documentTitle: string;
  body: string;
}

const EVIDENCE_KINDS = new Set(["contract", "invoice", "delivery_note", "payment"]);

function header(i: FollowUpLetterInput, heading: string): string {
  const { caseFile, asOf } = i;
  return `# ${heading}

**From:** ${caseFile.creditor}  
**To:** ${caseFile.debtor}${caseFile.debtorEmail ? ` (${caseFile.debtorEmail})` : ""}  
**Date:** ${asOf}  
**Our reference:** ${caseFile.reference}

Dear Sirs,
`;
}

const signOff = (i: FollowUpLetterInput) => `Yours faithfully,

${i.caseFile.creditor}

_Drafted by the DisputeOS Negotiation agent. Sent only after human approval._`;

const deadline = (i: FollowUpLetterInput) => addDays(i.asOf, i.followUpDays ?? 14);
const quoted = (i: FollowUpLetterInput) => (i.analysis?.quote ? `\n> ${i.analysis.quote}\n` : "");

function rebuttalList(i: FollowUpLetterInput): string {
  const types = new Set(i.analysis?.disputeTypes ?? []);
  const relevant = i.challenges.filter((c) => [...types].some((t) => matchesType(c, t)));
  const rows = (relevant.length ? relevant : i.challenges).slice(0, 5);
  return rows.map((c) => `- **${c.title}.** ${c.rebuttal}`).join("\n");
}

const TYPE_HINTS: Record<string, RegExp> = {
  damage: /damag/i,
  quality: /quality/i,
  shortfall: /short/i,
  non_receipt: /never arrived|proof of delivery/i,
  pricing: /pric/i,
  other: /objection/i,
};

export function matchesType(c: Pick<Challenge, "title">, type: string): boolean {
  return (TYPE_HINTS[type] ?? /$^/).test(c.title);
}

function body(i: FollowUpLetterInput): { heading: string; text: string } {
  const amount = formatPence(i.amountPence);
  const due = deadline(i);
  switch (i.decision) {
    case "accept_offer":
      return { heading: "Acceptance of Settlement Offer", text: `Thank you for your proposal:${quoted(i)}\nWe accept **${amount}** in full and final settlement, provided payment reaches us by **${due}**. On receipt we will treat the account as closed. If payment is not received by that date, this acceptance lapses and the full sum of ${formatPence(i.demandPence)} remains due.` };
    case "counter_offer":
      return { heading: "Without Prejudice Save As To Costs — Response to Your Offer", text: `Thank you for your proposal:${quoted(i)}\nWe cannot accept that figure. Our claim has already been reduced to reflect every point we accept. As a final compromise we will accept **${amount}**, waiving statutory interest and compensation, if paid by **${due}**. After that date we will pursue the full sum of ${formatPence(i.demandPence)}.` };
    case "confirm_promise":
      return { heading: "Confirmation of Payment Date", text: `Thank you for confirming:${quoted(i)}\nWe note your commitment to pay **${amount}** by **${i.analysis?.promisedDate ?? due}**. We will take no further action before then. If payment is not received by that date, we will proceed without further notice.` };
    case "ask_for_date":
      return { heading: "Request for a Payment Date", text: `Thank you for your message:${quoted(i)}\nPlease confirm the date on which you will pay **${amount}**. We can agree a date no later than 30 days from today, or a short payment plan. Please reply by **${due}**.` };
    case "chase_balance":
      return { heading: "Part Payment Received — Balance Due", text: `Thank you for your message:${quoted(i)}\nOnce your payment has cleared, the balance of **${amount}** remains due. Please pay it by **${due}**.` };
    case "request_remittance":
      return { heading: "Request for Remittance Details", text: `Thank you for letting us know:${quoted(i)}\nWe have not yet been able to match a payment. Please send the payment date, amount and bank reference so we can reconcile it against the **${amount}** outstanding. Please reply by **${due}**.` };
    case "rebut_dispute":
      return { heading: "Response to Your Points", text: `We have considered the points you raise:${quoted(i)}\nOur position, based on the contract and delivery records, is:\n\n${rebuttalList(i)}\n\nAll adjustments we accept are already reflected in our figures. The sum of **${amount}** remains due by **${due}**.` };
    case "hold_and_review":
      return { heading: "Acknowledgement of Your Points", text: `Thank you for your message:${quoted(i)}\nWe are reviewing the points you raise against our records and will respond in full by **${due}**. This does not affect the sums due, which remain **${amount}**, and our rights are reserved.` };
    case "send_evidence": {
      const docs = i.documents.filter((d) => EVIDENCE_KINDS.has(d.kind)).map((d) => `- ${d.title}`).join("\n") || "- Copies of our invoices and delivery records";
      return { heading: "Supporting Documents", text: `As requested:${quoted(i)}\nWe enclose copies of:\n\n${docs}\n\nThese show the goods were supplied and invoiced as agreed. Please pay **${amount}** by **${due}**.` };
    }
    case "remind":
      return { heading: "Final Reminder Before Proceedings", text: `We wrote to you requesting payment of **${amount}** and have received neither payment nor a substantive response. Unless payment is received by **${due}**, we will issue a claim in the County Court without further notice and seek our costs.` };
    default:
      return { heading: "Our Response", text: `We refer to your recent message. The sum of **${amount}** remains due.` };
  }
}

const TITLES: Partial<Record<NegotiationDecision, (amount: string) => string>> = {
  accept_offer: (a) => `Accept the debtor's offer of ${a}`,
  counter_offer: (a) => `Counter-offer at ${a}`,
  confirm_promise: () => "Confirm the promised payment date",
  ask_for_date: () => "Ask for a firm payment date",
  chase_balance: (a) => `Acknowledge part payment and chase ${a}`,
  request_remittance: () => "Ask for remittance details",
  rebut_dispute: () => "Answer the debtor's points with our findings",
  hold_and_review: () => "Send a holding reply and review the new point",
  send_evidence: () => "Send the requested documents",
  remind: (a) => `Send a final reminder for ${a}`,
};

/** Builds the document for a follow-up move. */
export function followUpDocument(i: FollowUpLetterInput): FollowUpDocument {
  const amount = formatPence(i.amountPence);
  if (i.decision === "escalate") {
    return {
      title: `Escalate: issue a claim for ${amount}`,
      documentTitle: "Claim pack (Money Claim Online)",
      body: `_Pre-action steps are complete: the debtor has not paid or answered substantively. Approving files this pack to the case folder for issue; it is not submitted to court automatically._\n\n${i.claimPack}`,
    };
  }
  if (i.decision === "close_settled") {
    return {
      title: i.amountPence > 0 ? `Close the case as settled (${amount} reported paid)` : "Close the case",
      documentTitle: "Case closure memo",
      body: `# Case Closure Memo\n\n**Case:** ${i.caseFile.reference} — ${i.caseFile.title}  \n**Date:** ${i.asOf}\n\n${i.amountPence > 0 ? `The debtor reports paying **${amount}** against **${formatPence(i.demandPence)}** on the table.${quoted(i)}\n**Before approving, confirm the funds have cleared in the bank account.** Approving closes the case as settled and stops all follow-up.` : "No defensible balance remains and the debtor has not engaged. Approving closes the case and stops all follow-up."}`,
    };
  }
  const { heading, text } = body(i);
  return {
    title: (TITLES[i.decision] ?? (() => "Reply to the debtor"))(amount),
    documentTitle: heading,
    body: `${header(i, heading)}\n${text}\n\n${signOff(i)}`,
  };
}
