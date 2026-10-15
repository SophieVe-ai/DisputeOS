// Challenge agent: the internal devil's advocate. Attacks the legitimacy of OUR claim
// before the debtor (or a court) does, and decides which deductions are warranted.
import { z } from "zod";
import { daysBetween, formatPence } from "../money";
import { field } from "../parser";
import type {
  CaseDocument,
  Challenge,
  ChallengeOutput,
  DisputeFacts,
  EvidenceOutput,
  ReconciliationOutput,
  Recommendation,
  Severity,
} from "../types";
import { errorMessage, requirePrior, type Agent, type AgentContext } from "./context";
import { normaliseItem } from "./reconciliation";

const LIMITATION_YEARS = 6; // Limitation Act 1980, s.5 (simple contract)
const WORKING_TO_CALENDAR = 7 / 5;
const SEVERITY_PENALTY: Record<Severity, number> = { high: 0.2, medium: 0.1, low: 0.04 };
const BASE_CONFIDENCE = 0.95;
const MIN_CONFIDENCE = 0.05;
const MAX_CONFIDENCE = 0.99;
const NEGOTIATE_BELOW_CONFIDENCE = 0.7;

interface RuleInput {
  evidence: EvidenceOutput;
  reconciliation: ReconciliationOutput;
  asOf: string;
  creditor: string;
  documents: readonly CaseDocument[];
}

export function hasCreditorDemand(documents: readonly CaseDocument[], creditor: string): boolean {
  const key = creditor.toLowerCase().split(/\s+/)[0];
  return documents.some(
    (d) => d.kind === "correspondence" && (field(d.content, ["From"]) ?? "").toLowerCase().includes(key),
  );
}

function unitPriceFor(item: string | null, recon: ReconciliationOutput): number {
  if (!item) return 0;
  const line = recon.lines.find((l) => normaliseItem(l.item) === normaliseItem(item));
  if (!line) return 0;
  return line.contractUnitPence === null ? line.invoicedUnitPence : Math.min(line.contractUnitPence, line.invoicedUnitPence);
}

function deliveryDateFor(evidence: EvidenceOutput): string | null {
  return evidence.facts.deliveries.map((d) => d.date).filter((d): d is string => !!d).sort()[0] ?? null;
}

function challengeDamage(d: DisputeFacts, input: RuleInput, id: string): Challenge {
  const { evidence, reconciliation } = input;
  const unit = unitPriceFor(d.item, reconciliation);
  const fullImpact = (d.qty ?? 0) * unit;
  const inspection = evidence.facts.contract?.inspectionDays ?? null;
  const delivered = deliveryDateFor(evidence);
  const raisedAfter = delivered && d.date ? daysBetween(delivered, d.date) : null;
  const base = {
    id,
    title: `Debtor alleges ${d.type === "quality" ? "poor quality" : "damaged goods"}${d.item ? ` (${d.item})` : ""}`,
    argument: `The debtor says: “${d.claim}”. If true, we cannot charge for ${d.qty ?? "the affected"} unit(s).`,
    severity: (fullImpact > 0 ? "medium" : "low") as Severity,
    basisDocId: d.docId,
    source: "rules" as const,
  };
  if (inspection !== null && raisedAfter !== null) {
    const window = Math.ceil(inspection * WORKING_TO_CALENDAR);
    if (raisedAfter <= window) {
      return d.qty
        ? { ...base, verdict: "upheld", impactPence: fullImpact, rebuttal: `Raised ${raisedAfter} day(s) after delivery — inside the ${inspection}-day inspection period. Deduct ${formatPence(fullImpact)}.` }
        : { ...base, verdict: "partially_upheld", impactPence: 0, rebuttal: `Raised in time, but no quantity specified. Request photos and a quantified list before deducting.` };
    }
    return { ...base, severity: "low", verdict: "rebutted", impactPence: 0, rebuttal: `Raised ${raisedAfter} days after delivery, outside the ${inspection}-day inspection period; goods were signed for. Deemed accepted.` };
  }
  const half = Math.round(fullImpact / 2);
  return { ...base, verdict: "partially_upheld", impactPence: half, rebuttal: `No contractual inspection period to rely on. Prudently discount 50% of the alleged loss (${formatPence(half)}).` };
}

function challengeFromDispute(d: DisputeFacts, input: RuleInput, id: string): Challenge {
  const { reconciliation, evidence } = input;
  const common = { id, basisDocId: d.docId, source: "rules" as const, argument: `The debtor says: “${d.claim}”.` };
  switch (d.type) {
    case "damage":
    case "quality":
      return challengeDamage(d, input, id);
    case "pricing":
      return reconciliation.overchargePence > 0
        ? { ...common, title: "Debtor disputes pricing", severity: "medium", verdict: "upheld", impactPence: 0, rebuttal: `Correct — we invoiced ${formatPence(reconciliation.overchargePence)} above contract price. Already removed in reconciliation; issue a credit note.` }
        : { ...common, title: "Debtor disputes pricing", severity: "low", verdict: "rebutted", impactPence: 0, rebuttal: "Invoiced prices match the contract price list." };
    case "shortfall":
      return reconciliation.shortDeliveryPence > 0
        ? { ...common, title: "Debtor alleges short delivery", severity: "medium", verdict: "upheld", impactPence: 0, rebuttal: `Delivery records confirm a shortfall worth ${formatPence(reconciliation.shortDeliveryPence)}. Already removed in reconciliation.` }
        : { ...common, title: "Debtor alleges short delivery", severity: "low", verdict: "rebutted", impactPence: 0, rebuttal: "Signed delivery notes show the full invoiced quantities were delivered." };
    case "non_receipt": {
      const signed = evidence.facts.deliveries.some((del) => del.signedBy);
      return signed
        ? { ...common, title: "Debtor claims goods never arrived", severity: "low", verdict: "rebutted", impactPence: 0, rebuttal: "A signed proof of delivery is on file." }
        : { ...common, title: "Debtor claims goods never arrived", severity: "high", verdict: "upheld", impactPence: reconciliation.supportedPrincipalPence, rebuttal: "No signed proof of delivery — we cannot currently prove delivery." };
    }
    default:
      return { ...common, title: "Other objection raised by debtor", severity: "low", verdict: "partially_upheld", impactPence: 0, rebuttal: "Not a recognised legal defence to payment; address it in correspondence." };
  }
}

function selfChallenges(input: RuleInput, nextId: () => string): Challenge[] {
  const { evidence, reconciliation, asOf, creditor } = input;
  const out: Challenge[] = [];
  const make = (c: Omit<Challenge, "id" | "source">): Challenge => ({ ...c, id: nextId(), source: "rules" });
  if (reconciliation.overchargePence > 0 && !evidence.facts.disputes.some((d) => d.type === "pricing")) {
    out.push(make({ title: "We invoiced above the agreed price", argument: "Our invoice exceeds contract pricing; the debtor has not noticed yet.", severity: "medium", basisDocId: evidence.facts.contract?.docId ?? null, verdict: "upheld", impactPence: 0, rebuttal: `Removed ${formatPence(reconciliation.overchargePence)} in reconciliation. Claiming it would damage credibility.` }));
  }
  if (!evidence.facts.contract) {
    out.push(make({ title: "No signed contract on file", argument: "Without a contract the debtor can contest prices and payment terms.", severity: "medium", basisDocId: null, verdict: "partially_upheld", impactPence: 0, rebuttal: "Invoices, delivery and course of dealing still evidence a contract; statutory 30-day terms apply." }));
  }
  if (evidence.facts.deliveries.length === 0) {
    out.push(make({ title: "No proof of delivery", argument: "We cannot show the goods or services were supplied.", severity: "high", basisDocId: null, verdict: "upheld", impactPence: 0, rebuttal: "Obtain courier PODs or site sign-off before escalating." }));
  }
  evidence.facts.deliveries
    .filter((d) => !d.signedBy)
    .forEach((d) => out.push(make({ title: "Unsigned delivery note", argument: "An unsigned delivery note is weak proof of receipt.", severity: "medium", basisDocId: d.docId, verdict: "partially_upheld", impactPence: 0, rebuttal: "Corroborate with courier tracking or later correspondence acknowledging receipt." })));
  const oldest = evidence.facts.invoices.map((i) => i.date).filter((d): d is string => !!d).sort()[0];
  if (oldest && daysBetween(oldest, asOf) > LIMITATION_YEARS * 365) {
    out.push(make({ title: "Claim may be statute-barred", argument: `Invoice dated ${oldest} is over ${LIMITATION_YEARS} years old (Limitation Act 1980).`, severity: "high", basisDocId: null, verdict: "upheld", impactPence: reconciliation.supportedPrincipalPence, rebuttal: "Unless there is a written acknowledgment or part payment within six years, do not pursue." }));
  }
  if (!hasCreditorDemand(input.documents, creditor)) {
    out.push(make({ title: "No prior written demand", argument: "Courts expect a letter before action and reasonable time to pay before proceedings.", severity: "low", basisDocId: null, verdict: "partially_upheld", impactPence: 0, rebuttal: "Send a compliant letter before action first (Practice Direction – Pre-Action Conduct)." }));
  }
  return out;
}

export function ruleChallenges(input: RuleInput): Challenge[] {
  let n = 0;
  const nextId = () => `C${++n}`;
  const fromDisputes = input.evidence.facts.disputes.map((d) => challengeFromDispute(d, input, nextId()));
  return [...fromDisputes, ...selfChallenges(input, nextId)];
}

export function score(challenges: Challenge[], recon: ReconciliationOutput): Omit<ChallengeOutput, "summary" | "challenges"> {
  const live = challenges.filter((c) => c.verdict !== "rebutted");
  const deductions = Math.min(
    recon.supportedPrincipalPence,
    live.reduce((s, c) => s + c.impactPence, 0),
  );
  const defensible = recon.supportedPrincipalPence - deductions;
  const penalty = live.reduce((s, c) => s + SEVERITY_PENALTY[c.severity] * (c.verdict === "upheld" ? 1 : 0.5), 0);
  const confidence = Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, BASE_CONFIDENCE - penalty));
  const debtorPointsStand = live.some((c) => c.basisDocId && c.impactPence > 0);
  let recommendation: Recommendation = "pursue_full";
  if (defensible <= 0) recommendation = "write_off";
  else if (confidence < NEGOTIATE_BELOW_CONFIDENCE) recommendation = "negotiate";
  else if (deductions > 0 || debtorPointsStand || recon.overchargePence > 0 || recon.shortDeliveryPence > 0) recommendation = "pursue_reduced";
  return { deductionsPence: deductions, defensiblePrincipalPence: defensible, confidence: Math.round(confidence * 100) / 100, recommendation };
}

const LlmChallengeSchema = z.object({
  additional: z.array(
    z.object({
      title: z.string(),
      argument: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      basisDocId: z.string().nullable(),
      verdict: z.enum(["upheld", "partially_upheld", "rebutted"]),
      rebuttal: z.string(),
      impactPence: z.number().int().min(0),
    }),
  ),
});

const SYSTEM = `You are the Challenge agent in DisputeOS: an adversarial reviewer acting as the debtor's best lawyer
under English law. Your job is to find weaknesses in the CREDITOR's claim that the rule-based checks missed.
Do NOT repeat the existing challenges. Only set impactPence > 0 for a distinct monetary deduction not already
reflected in the reconciled principal, and be conservative. Return an empty list if there is nothing new.`;

async function claudeChallenges(ctx: AgentContext, rules: Challenge[], input: RuleInput): Promise<Challenge[]> {
  const docs = ctx.documents.map((d) => `<document id="${d.id}" kind="${d.kind}">\n${d.content}\n</document>`).join("\n");
  const result = await ctx.llm!.structured({
    schema: LlmChallengeSchema,
    system: SYSTEM,
    prompt:
      `${docs}\n\nReconciliation: ${JSON.stringify(input.reconciliation)}\n\nExisting challenges: ${JSON.stringify(rules)}\n\n` +
      "List up to 3 additional, genuinely distinct challenges.",
  });
  const docIds = new Set(ctx.documents.map((d) => d.id));
  return result.additional.slice(0, 3).map((c, i) => ({
    ...c,
    basisDocId: c.basisDocId && docIds.has(c.basisDocId) ? c.basisDocId : null,
    id: `AI${i + 1}`,
    source: "claude" as const,
  }));
}

function summarise(out: Omit<ChallengeOutput, "summary">, recon: ReconciliationOutput): string {
  const upheld = out.challenges.filter((c) => c.verdict === "upheld").length;
  const rebutted = out.challenges.filter((c) => c.verdict === "rebutted").length;
  return (
    `Raised ${out.challenges.length} challenge(s): ${upheld} upheld, ${rebutted} rebutted. ` +
    `Defensible principal ${formatPence(out.defensiblePrincipalPence)} of ${formatPence(recon.supportedPrincipalPence)} reconciled ` +
    `(confidence ${Math.round(out.confidence * 100)}%). Recommendation: ${out.recommendation.replace("_", " ")}.`
  );
}

export const challengeAgent: Agent<ChallengeOutput> = {
  name: "challenge",
  title: "Challenge agent",
  async run(ctx) {
    const input: RuleInput = {
      evidence: requirePrior(ctx, "evidence"),
      reconciliation: requirePrior(ctx, "reconciliation"),
      asOf: ctx.asOf,
      creditor: ctx.caseFile.creditor,
      documents: ctx.documents,
    };
    await ctx.log("challenge.started", { disputes: input.evidence.facts.disputes.length });
    const rules = ruleChallenges(input);
    let challenges = rules;
    let engine: "claude" | "deterministic" = "deterministic";
    if (ctx.llm) {
      try {
        challenges = [...rules, ...(await claudeChallenges(ctx, rules, input))];
        engine = "claude";
      } catch (err) {
        await ctx.log("challenge.claude_fallback", { reason: errorMessage(err) });
      }
    }
    for (const c of challenges) {
      await ctx.pace(0.3);
      await ctx.log("challenge.raised", { id: c.id, title: c.title, verdict: c.verdict, impactPence: c.impactPence });
    }
    const scored = { challenges, ...score(challenges, input.reconciliation) };
    return { output: { summary: summarise(scored, input.reconciliation), ...scored }, engine };
  },
};
