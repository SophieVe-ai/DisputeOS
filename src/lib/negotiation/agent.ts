// Negotiation agent: the long-running fifth agent. It sleeps while the case waits on the
// debtor and is woken by a reply (or by a deadline passing with no reply). Each turn it
// reads the reply, assesses where the negotiation stands, and drafts the next move for
// human approval. Like the other agents it only gets an append-only `log` closure.
import { z } from "zod";
import type { LlmClient } from "../agents/llm";
import { errorMessage } from "../agents/context";
import { interestSchedule } from "../agents/reconciliation";
import { courtClaimPack, totalDemand, type LetterInput } from "../agents/templates";
import { formatPence } from "../money";
import {
  DISPUTE_TYPES,
  type CaseDocument,
  type ChallengeOutput,
  type CorrespondenceMessage,
  type DisputeCase,
  type Engine,
  type EvidenceOutput,
  type NegotiationOutput,
  type Proposal,
  type ProposalDraft,
  type ReconciliationOutput,
  type ReplyAnalysis,
  type ResolutionOutput,
  type WakeupKind,
} from "../types";
import { classifyReplyRules, classifyReplyWithClaude } from "./classify";
import { followUpDocument, matchesType } from "./letters";
import { decideNextMove, type PolicyResult } from "./policy";

/** Kinds that put a figure in front of the debtor; the latest batch of these sets the demand. */
const DEMAND_KINDS = new Set(["send_letter_before_action", "offer_settlement", "accept_offer", "send_reply", "send_reminder"]);

export interface NegotiationContext {
  readonly caseFile: Readonly<DisputeCase>;
  readonly documents: readonly Readonly<CaseDocument>[];
  readonly prior: {
    readonly evidence: EvidenceOutput;
    readonly reconciliation: ReconciliationOutput;
    readonly challenge: ChallengeOutput;
    readonly resolution: ResolutionOutput;
  };
  /** Proposals already executed in this run, oldest first. */
  readonly executed: readonly Readonly<Proposal>[];
  readonly trigger: { readonly kind: WakeupKind; readonly reason: string; readonly message: Readonly<CorrespondenceMessage> | null };
  readonly asOf: string;
  readonly baseRatePercent: number;
  readonly llm: LlmClient | null;
  log(action: string, payload?: unknown): void;
  pace(fraction?: number): Promise<void>;
}

export interface NegotiationPosition {
  demandPence: number;
  floorPence: number;
  remindersSent: number;
  counterOffersMade: number;
  assessedDisputeTypes: string[];
}

/** The lowest figure in the most recent batch of letters actually sent; null before anything is sent. */
export function currentDemandPence(executed: readonly Pick<Proposal, "kind" | "turnId" | "amountPence">[]): number | null {
  const sent = executed.filter((p) => DEMAND_KINDS.has(p.kind));
  if (sent.length === 0) return null;
  const lastTurn = sent[sent.length - 1].turnId;
  const latestBatch = sent.filter((p) => p.turnId === lastTurn && p.amountPence > 0);
  return latestBatch.length ? Math.min(...latestBatch.map((p) => p.amountPence)) : null;
}

/** Where the negotiation stands, derived only from what has actually been sent. */
export function assessPosition(ctx: Pick<NegotiationContext, "prior" | "executed">, letter: LetterInput): NegotiationPosition {
  return {
    demandPence: currentDemandPence(ctx.executed) ?? totalDemand(letter),
    floorPence: ctx.prior.challenge.defensiblePrincipalPence,
    remindersSent: ctx.executed.filter((p) => p.kind === "send_reminder").length,
    counterOffersMade: ctx.executed.filter((p) => p.kind === "offer_settlement" && p.turnId !== null).length,
    assessedDisputeTypes: DISPUTE_TYPES.filter((t) => ctx.prior.challenge.challenges.some((c) => matchesType(c, t))),
  };
}

async function readReply(ctx: NegotiationContext): Promise<{ analysis: ReplyAnalysis | null; usedClaude: boolean }> {
  const message = ctx.trigger.message;
  if (!message) return { analysis: null, usedClaude: false };
  if (ctx.llm) {
    try {
      return { analysis: await classifyReplyWithClaude(ctx.llm, message.body, ctx.asOf), usedClaude: true };
    } catch (err) {
      ctx.log("negotiation.claude_fallback", { reason: errorMessage(err) });
    }
  }
  return { analysis: classifyReplyRules(message.body, ctx.asOf), usedClaude: false };
}

const PolishSchema = z.object({ letter: z.string() });

/** Claude may improve the wording; the guard-rail keeps the template if any figure goes missing. */
async function polish(ctx: NegotiationContext, draft: ProposalDraft, mustInclude: string[]): Promise<ProposalDraft> {
  const out = await ctx.llm!.structured({
    schema: PolishSchema,
    system: `You are the Negotiation agent in DisputeOS. Improve the tone and clarity of UK B2B dispute correspondence.
Keep it firm, courteous and compliant with the Practice Direction – Pre-Action Conduct. Never change, add or remove any figure
or date, never threaten anything unlawful, keep the Markdown structure and stay under 350 words.`,
    prompt: `Rewrite this letter, keeping every figure and date exactly:\n\n${draft.documentBody}`,
  });
  const missing = mustInclude.filter((s) => !out.letter.includes(s));
  if (missing.length) throw new Error(`Claude draft dropped ${missing.join(", ")}; template kept`);
  return { ...draft, documentBody: out.letter };
}

function buildDraft(ctx: NegotiationContext, move: PolicyResult, analysis: ReplyAnalysis | null, position: NegotiationPosition, letter: LetterInput): ProposalDraft | null {
  if (!move.action) return null;
  const doc = followUpDocument({
    caseFile: ctx.caseFile,
    asOf: ctx.asOf,
    decision: move.decision,
    amountPence: move.action.amountPence,
    followUpDays: move.action.followUpDays,
    analysis,
    demandPence: position.demandPence,
    floorPence: position.floorPence,
    challenges: ctx.prior.challenge.challenges,
    documents: ctx.documents,
    claimPack: courtClaimPack(letter),
  });
  return {
    kind: move.action.kind,
    title: doc.title,
    rationale: move.rationale,
    amountPence: move.action.amountPence,
    documentTitle: doc.documentTitle,
    documentBody: doc.body,
    followUpDays: move.action.followUpDays,
  };
}

function letterInput(ctx: NegotiationContext): LetterInput {
  const { evidence, reconciliation, challenge } = ctx.prior;
  const { interestPence, compensationPence } = interestSchedule(evidence.facts, challenge.defensiblePrincipalPence, ctx.asOf, ctx.baseRatePercent);
  return { caseFile: ctx.caseFile, evidence, reconciliation, challenge, asOf: ctx.asOf, baseRatePercent: ctx.baseRatePercent, interestPence, compensationPence };
}

const OUTBOUND_KINDS = new Set(["send_reply", "send_reminder", "accept_offer", "offer_settlement"]);

export const negotiationAgent = {
  name: "negotiation",
  title: "Negotiation agent",
  async run(ctx: NegotiationContext): Promise<{ output: NegotiationOutput; engine: Engine }> {
    ctx.log("negotiation.started", { trigger: ctx.trigger.kind, reason: ctx.trigger.reason, messageId: ctx.trigger.message?.id ?? null });
    const { analysis, usedClaude } = await readReply(ctx);
    if (analysis) {
      await ctx.pace(0.3);
      ctx.log("negotiation.reply_classified", { intent: analysis.intent, amountPence: analysis.amountPence, promisedDate: analysis.promisedDate, disputeTypes: analysis.disputeTypes, source: analysis.source, rejected: analysis.rejected });
    }

    const letter = letterInput(ctx);
    const position = assessPosition(ctx, letter);
    await ctx.pace(0.3);
    ctx.log("negotiation.position_assessed", { demandPence: position.demandPence, floorPence: position.floorPence, remindersSent: position.remindersSent, counterOffersMade: position.counterOffersMade });

    const move = decideNextMove({ trigger: ctx.trigger.kind, analysis, asOf: ctx.asOf, ...position });
    let draft = buildDraft(ctx, move, analysis, position, letter);
    let polished = false;
    if (draft && ctx.llm && OUTBOUND_KINDS.has(draft.kind)) {
      try {
        draft = await polish(ctx, draft, [formatPence(draft.amountPence)]);
        polished = true;
      } catch (err) {
        ctx.log("negotiation.claude_fallback", { reason: errorMessage(err) });
      }
    }
    if (draft) {
      await ctx.pace(0.3);
      ctx.log("negotiation.document_drafted", { kind: draft.kind, amountPence: draft.amountPence, title: draft.title, followUpDays: draft.followUpDays });
    }

    const proposals = draft ? [draft] : [];
    const heard = analysis ? `Reply read as ${analysis.intent.replace(/_/g, " ")}` : `No reply by the deadline (${ctx.trigger.reason})`;
    const output: NegotiationOutput = {
      trigger: ctx.trigger.kind,
      summary: `${heard}. Decision: ${move.decision.replace(/_/g, " ")}${draft ? `, drafted “${draft.title}” for approval` : ", nothing to send"}.`,
      analysis,
      demandPence: position.demandPence,
      floorPence: position.floorPence,
      decision: move.decision,
      rationale: move.rationale,
      proposals,
    };
    return { output, engine: usedClaude || polished ? "claude" : "deterministic" };
  },
};
