// Deterministic document templates (used directly offline, and as the fallback / guard-rail for Claude drafts).
import { addDays, formatPence } from "../money";
import { statutoryRatePercent } from "../interest";
import type { ChallengeOutput, DisputeCase, EvidenceOutput, ReconciliationOutput } from "../types";

export const PAYMENT_WINDOW_DAYS = 14;

export interface LetterInput {
  caseFile: DisputeCase;
  evidence: EvidenceOutput;
  reconciliation: ReconciliationOutput;
  challenge: ChallengeOutput;
  asOf: string;
  baseRatePercent: number;
  interestPence: number;
  compensationPence: number;
}

function invoiceList(input: LetterInput): string {
  return input.evidence.facts.invoices
    .map((i) => `- Invoice ${i.number} dated ${i.date ?? "n/a"} for ${formatPence(i.totalPence)}${i.dueDate ? ` (due ${i.dueDate})` : ""}`)
    .join("\n");
}

function adjustmentsParagraph(input: LetterInput): string {
  const lines: string[] = [];
  if (input.reconciliation.overchargePence > 0) lines.push(`- ${formatPence(input.reconciliation.overchargePence)} credited where our invoice exceeded the agreed contract price`);
  if (input.reconciliation.shortDeliveryPence > 0) lines.push(`- ${formatPence(input.reconciliation.shortDeliveryPence)} credited for goods not delivered`);
  input.challenge.challenges
    .filter((c) => c.verdict !== "rebutted" && c.impactPence > 0)
    .forEach((c) => lines.push(`- ${formatPence(c.impactPence)} allowed in respect of: ${c.title.toLowerCase()}`));
  if (input.reconciliation.paidPence > 0) lines.push(`- ${formatPence(input.reconciliation.paidPence)} already received from you`);
  return lines.length ? `We have reviewed your account carefully and made the following adjustments in your favour:\n${lines.join("\n")}\n` : "";
}

export function totalDemand(input: LetterInput): number {
  return input.challenge.defensiblePrincipalPence + input.interestPence + input.compensationPence;
}

export function letterBeforeAction(input: LetterInput): string {
  const { caseFile, asOf } = input;
  const rate = statutoryRatePercent(input.baseRatePercent);
  const deadline = addDays(asOf, PAYMENT_WINDOW_DAYS);
  return `# Letter Before Action

**From:** ${caseFile.creditor}  
**To:** ${caseFile.debtor}${caseFile.debtorEmail ? ` (${caseFile.debtorEmail})` : ""}  
**Date:** ${asOf}  
**Our reference:** ${caseFile.reference}

Dear Sirs,

We write regarding the following unpaid invoice(s):

${invoiceList(input)}

${adjustmentsParagraph(input)}
The principal sum now due is **${formatPence(input.challenge.defensiblePrincipalPence)}**.

Under the Late Payment of Commercial Debts (Interest) Act 1998 we are entitled to statutory interest at ${rate.toFixed(2)}% per annum (8% above the Bank of England base rate) and fixed compensation:

| Item | Amount |
| --- | --- |
| Principal | ${formatPence(input.challenge.defensiblePrincipalPence)} |
| Statutory interest (from each invoice due date) | ${formatPence(input.interestPence)} |
| Fixed compensation | ${formatPence(input.compensationPence)} |
| **Total now due** | **${formatPence(totalDemand(input))}** |

Interest continues to accrue daily until payment.

Please pay **${formatPence(totalDemand(input))}** by **${deadline}** (${PAYMENT_WINDOW_DAYS} days from the date of this letter). If you dispute any part of this sum, please tell us in writing by that date, explaining why and enclosing any documents you rely on.

If we receive neither payment nor a substantive response by ${deadline}, we intend to issue a claim in the County Court without further notice, and to seek our costs. We would prefer to resolve this without proceedings and remain open to discussing a payment plan or alternative dispute resolution.

Yours faithfully,

${caseFile.creditor}

_Prepared by DisputeOS agents. Released only after human approval._`;
}

export function settlementOffer(input: LetterInput): string {
  const { caseFile, asOf } = input;
  const deadline = addDays(asOf, PAYMENT_WINDOW_DAYS);
  return `# Without Prejudice Save As To Costs — Settlement Offer

**From:** ${caseFile.creditor}  
**To:** ${caseFile.debtor}  
**Date:** ${asOf}  
**Reference:** ${caseFile.reference}

Dear Sirs,

To resolve this matter promptly and preserve our trading relationship, we offer to accept **${formatPence(input.challenge.defensiblePrincipalPence)}** in full and final settlement of invoice(s):

${invoiceList(input)}

${adjustmentsParagraph(input)}
If payment is received by **${deadline}**, we will waive statutory interest (${formatPence(input.interestPence)}) and fixed compensation (${formatPence(input.compensationPence)}). This offer is open until ${deadline}, after which we will pursue the full sum of ${formatPence(totalDemand(input))}.

Yours faithfully,

${caseFile.creditor}`;
}

export function creditNote(input: LetterInput, amountPence: number): string {
  const { caseFile, asOf, reconciliation } = input;
  const rows = reconciliation.lines
    .filter((l) => l.variancePence > 0)
    .map((l) => `| ${l.item} | ${l.flags.join("; ")} | ${formatPence(l.variancePence)} |`)
    .join("\n");
  return `# Credit Note

**Issued by:** ${caseFile.creditor}  
**Issued to:** ${caseFile.debtor}  
**Date:** ${asOf}  
**Reference:** ${caseFile.reference}-CN

| Item | Reason | Credit |
| --- | --- | --- |
${rows}
| **Total credit** | | **${formatPence(amountPence)}** |

This credit note corrects invoicing errors identified during our internal reconciliation.`;
}

export function courtClaimPack(input: LetterInput): string {
  const { caseFile } = input;
  return `# Money Claim Online — Draft Particulars of Claim

**Claimant:** ${caseFile.creditor}  
**Defendant:** ${caseFile.debtor}

1. The Claimant supplied goods to the Defendant under the contract and invoice(s) listed below.
${invoiceList(input)}
2. The goods were delivered and accepted. The Defendant has failed to pay ${formatPence(input.challenge.defensiblePrincipalPence)}, after allowing all credits due.
3. The Claimant claims statutory interest under the Late Payment of Commercial Debts (Interest) Act 1998 of ${formatPence(input.interestPence)} to date, calculated from each invoice due date, and continuing, and fixed compensation of ${formatPence(input.compensationPence)}.

**Amount claimed:** ${formatPence(totalDemand(input))} plus court fee and continuing interest.

_File only if the letter-before-action deadline passes without payment or a reasoned response._`;
}

export function writeOffMemo(input: LetterInput): string {
  return `# Internal Write-off Memo

**Case:** ${input.caseFile.reference} — ${input.caseFile.title}
**Outstanding on ledger:** ${formatPence(input.reconciliation.outstandingPence)} (of which ${formatPence(input.reconciliation.overchargePence + input.reconciliation.shortDeliveryPence)} is cleared by credit note)

The Challenge agent concluded the claim is not defensible:

${input.challenge.challenges.filter((c) => c.verdict === "upheld").map((c) => `- ${c.title}: ${c.rebuttal}`).join("\n")}

Recommend writing off the balance and correcting the sales ledger.`;
}
