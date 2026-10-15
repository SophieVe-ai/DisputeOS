// Resolution agent: chooses a strategy and drafts the response documents.
// Every proposal it produces is inert until a human approves it.
import { z } from "zod";
import { formatPence } from "../money";
import type { ProposalDraft, ResolutionOutput } from "../types";
import { errorMessage, requirePrior, type Agent, type AgentContext } from "./context";
import { interestSchedule } from "./reconciliation";
import {
  courtClaimPack,
  creditNote,
  letterBeforeAction,
  PAYMENT_WINDOW_DAYS,
  settlementOffer,
  totalDemand,
  writeOffMemo,
  type LetterInput,
} from "./templates";

const COURT_PACK_MIN_DAYS_OVERDUE = 60;
const COURT_PACK_MIN_CONFIDENCE = 0.7;

export function buildLetterInput(ctx: AgentContext): LetterInput {
  const evidence = requirePrior(ctx, "evidence");
  const reconciliation = requirePrior(ctx, "reconciliation");
  const challenge = requirePrior(ctx, "challenge");
  const { interestPence, compensationPence } = interestSchedule(evidence.facts, challenge.defensiblePrincipalPence, ctx.asOf, ctx.baseRatePercent);
  return { caseFile: ctx.caseFile, evidence, reconciliation, challenge, asOf: ctx.asOf, baseRatePercent: ctx.baseRatePercent, interestPence, compensationPence };
}

export function draftProposals(input: LetterInput): ProposalDraft[] {
  const { reconciliation, challenge } = input;
  const proposals: ProposalDraft[] = [];
  const credit = reconciliation.overchargePence + reconciliation.shortDeliveryPence;
  if (credit > 0) {
    proposals.push({ kind: "issue_credit_note", title: `Issue credit note for ${formatPence(credit)}`, rationale: "Our own invoice overstates what is owed. Correcting it first makes the remaining claim credible.", amountPence: credit, documentTitle: "Credit note", documentBody: creditNote(input, credit) });
  }
  if (challenge.defensiblePrincipalPence <= 0) {
    proposals.push({ kind: "write_off", title: "Write off the balance", rationale: "The Challenge agent found the claim is not defensible.", amountPence: Math.max(0, reconciliation.outstandingPence - credit), documentTitle: "Write-off memo", documentBody: writeOffMemo(input) });
    return proposals;
  }
  const total = totalDemand(input);
  proposals.push({ kind: "send_letter_before_action", title: `Send letter before action for ${formatPence(total)}`, rationale: `Formal demand for the defensible principal plus statutory interest and compensation, giving 14 days to pay (Practice Direction – Pre-Action Conduct).`, amountPence: total, documentTitle: "Letter before action", documentBody: letterBeforeAction(input), followUpDays: PAYMENT_WINDOW_DAYS });
  if (challenge.recommendation === "negotiate" || challenge.recommendation === "pursue_reduced") {
    proposals.push({ kind: "offer_settlement", title: `Offer settlement at ${formatPence(challenge.defensiblePrincipalPence)}`, rationale: "Some debtor points have merit. Waiving interest for prompt payment is cheaper than litigation and preserves the relationship.", amountPence: challenge.defensiblePrincipalPence, documentTitle: "Settlement offer", documentBody: settlementOffer(input), followUpDays: PAYMENT_WINDOW_DAYS });
  }
  if (reconciliation.daysOverdue > COURT_PACK_MIN_DAYS_OVERDUE && challenge.confidence >= COURT_PACK_MIN_CONFIDENCE) {
    proposals.push({ kind: "prepare_court_claim", title: "Prepare Money Claim Online pack", rationale: `${reconciliation.daysOverdue} days overdue with ${Math.round(challenge.confidence * 100)}% confidence. Ready to file if the letter-before-action deadline passes.`, amountPence: total, documentTitle: "Draft particulars of claim", documentBody: courtClaimPack(input) });
  }
  return proposals;
}

const LlmDraftSchema = z.object({
  strategy: z.string(),
  letterBeforeAction: z.string(),
});

const SYSTEM = `You are the Resolution agent in DisputeOS. You draft firm, professional, courteous UK B2B
correspondence compliant with the Practice Direction – Pre-Action Conduct. Never change any figure you are given,
never threaten anything unlawful, and keep letters under 450 words in Markdown.`;

/** Claude drafts the strategy and letter; the guard-rail rejects any draft that loses the exact total. */
async function claudeDraft(ctx: AgentContext, input: LetterInput, proposals: ProposalDraft[]): Promise<{ strategy: string; proposals: ProposalDraft[] }> {
  const total = formatPence(totalDemand(input));
  const draft = await ctx.llm!.structured({
    schema: LlmDraftSchema,
    system: SYSTEM,
    prompt:
      `Case: ${JSON.stringify(input.caseFile)}\nChallenge findings: ${JSON.stringify(input.challenge)}\n` +
      `Template letter (keep every figure exactly):\n${letterBeforeAction(input)}\n\n` +
      `Write a one-paragraph strategy and an improved letter before action demanding exactly ${total}.`,
  });
  if (!draft.letterBeforeAction.includes(total)) {
    throw new Error(`Claude letter omitted the exact total ${total}; template kept`);
  }
  return {
    strategy: draft.strategy,
    proposals: proposals.map((p) => (p.kind === "send_letter_before_action" ? { ...p, documentBody: draft.letterBeforeAction } : p)),
  };
}

function defaultStrategy(input: LetterInput, proposals: ProposalDraft[]): string {
  const steps = proposals.map((p, i) => `${i + 1}. ${p.title}`).join(" ");
  return `Recommendation: ${input.challenge.recommendation.replace("_", " ")}. ${steps}`;
}

export const resolutionAgent: Agent<ResolutionOutput> = {
  name: "resolution",
  title: "Resolution agent",
  async run(ctx) {
    const input = buildLetterInput(ctx);
    await ctx.log("resolution.started", { recommendation: input.challenge.recommendation });
    let proposals = draftProposals(input);
    let strategy = defaultStrategy(input, proposals);
    let engine: "claude" | "deterministic" = "deterministic";
    if (ctx.llm && input.challenge.defensiblePrincipalPence > 0) {
      try {
        ({ strategy, proposals } = await claudeDraft(ctx, input, proposals));
        engine = "claude";
      } catch (err) {
        await ctx.log("resolution.claude_fallback", { reason: errorMessage(err) });
      }
    }
    for (const p of proposals) {
      await ctx.pace(0.3);
      await ctx.log("resolution.document_drafted", { kind: p.kind, amountPence: p.amountPence, title: p.title });
    }
    const summary = `Drafted ${proposals.length} action(s) for human approval.`;
    return { output: { summary, strategy, interestPence: input.interestPence, compensationPence: input.compensationPence, proposals }, engine };
  },
};
