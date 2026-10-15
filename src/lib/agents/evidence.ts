// Evidence agent: locates the contract, invoices, delivery records, payments and
// relevant correspondence, extracts structured facts and flags evidential gaps.
import { z } from "zod";
import { formatPence } from "../money";
import { extractFacts } from "../parser";
import { sha256Hex } from "../ledger/hash";
import { DISPUTE_TYPES, type CaseDocument, type DisputeFacts, type EvidenceItem, type EvidenceOutput, type ExtractedFacts } from "../types";
import { errorMessage, type Agent, type AgentContext } from "./context";
import { extractWithClaude, mergeFacts, unreadDocuments } from "./extraction";

const LlmEvidenceSchema = z.object({
  summary: z.string(),
  gaps: z.array(z.string()),
  disputes: z.array(
    z.object({
      docId: z.string(),
      date: z.string().nullable(),
      type: z.enum(DISPUTE_TYPES),
      item: z.string().nullable(),
      qty: z.number().int().nullable(),
      claim: z.string(),
    }),
  ),
});

const SYSTEM = `You are the Evidence agent in DisputeOS, a UK B2B debt-dispute resolution system.
You read a creditor's case file and identify what the debtor disputes and what evidence is missing.
Be precise and conservative: only report disputes the DEBTOR actually raised in correspondence,
quote their words in "claim", and use ISO dates. Payment chasers sent by the creditor are not disputes.`;

export function describeDocument(doc: CaseDocument, facts: ExtractedFacts): string[] {
  const out: string[] = [];
  if (facts.contract?.docId === doc.id) {
    const c = facts.contract;
    if (c.paymentTermsDays) out.push(`Payment terms: ${c.paymentTermsDays} days`);
    if (c.inspectionDays) out.push(`Inspection period: ${c.inspectionDays} days from delivery`);
    c.lines.forEach((l) => out.push(`Agreed price — ${l.item}: ${formatPence(l.unitPricePence)} per unit`));
  }
  const inv = facts.invoices.find((i) => i.docId === doc.id);
  if (inv) {
    out.push(`Invoice ${inv.number} for ${formatPence(inv.totalPence)}${inv.dueDate ? `, due ${inv.dueDate}` : ""}`);
    inv.lines.forEach((l) => out.push(`${l.qty} × ${l.item} @ ${formatPence(l.unitPricePence)}`));
  }
  const del = facts.deliveries.find((d) => d.docId === doc.id);
  if (del) {
    del.lines.forEach((l) => out.push(`Delivered ${l.qty} × ${l.item}${del.date ? ` on ${del.date}` : ""}`));
    out.push(del.signedBy ? `Proof of delivery signed by ${del.signedBy}` : "Delivery note is NOT signed");
  }
  const pay = facts.payments.find((p) => p.docId === doc.id);
  if (pay) out.push(`Payment received: ${formatPence(pay.amountPence)}${pay.date ? ` on ${pay.date}` : ""}`);
  facts.disputes
    .filter((d) => d.docId === doc.id)
    .forEach((d) => out.push(`Debtor dispute (${d.type}): “${d.claim}”`));
  return out;
}

export function findGaps(facts: ExtractedFacts, docs: readonly CaseDocument[]): string[] {
  const gaps: string[] = [];
  if (!facts.contract) gaps.push("No signed contract or accepted quote found — agreed prices and terms cannot be confirmed.");
  if (facts.invoices.length === 0) gaps.push("No invoice found.");
  if (facts.deliveries.length === 0) gaps.push("No delivery note / proof of delivery found.");
  facts.deliveries.filter((d) => !d.signedBy).forEach((d) => gaps.push(`Delivery note ${d.docId} is unsigned.`));
  facts.invoices.filter((i) => !i.dueDate).forEach((i) => gaps.push(`Invoice ${i.number} has no due date; contract terms will be used.`));
  if (!docs.some((d) => d.kind === "correspondence")) gaps.push("No correspondence on file — no record of a prior payment demand.");
  return gaps;
}

export function deterministicEvidence(ctx: Pick<AgentContext, "documents" | "caseFile">): EvidenceOutput {
  const facts = extractFacts([...ctx.documents], ctx.caseFile);
  const items: EvidenceItem[] = ctx.documents.map((doc) => ({
    docId: doc.id,
    docTitle: doc.title,
    kind: doc.kind,
    relevance:
      doc.kind === "correspondence" && !facts.disputes.some((d) => d.docId === doc.id) ? "supporting" : "primary",
    facts: describeDocument(doc, facts),
  }));
  const gaps = findGaps(facts, ctx.documents);
  const summary =
    `Reviewed ${ctx.documents.length} documents: ${facts.invoices.length} invoice(s), ` +
    `${facts.deliveries.length} delivery record(s), ${facts.payments.length} payment(s). ` +
    `${facts.disputes.length} dispute point(s) raised by ${ctx.caseFile.debtor}; ${gaps.length} evidential gap(s).`;
  return { summary, items, facts, gaps };
}

function mergeDisputes(rules: DisputeFacts[], llm: DisputeFacts[], docIds: Set<string>): DisputeFacts[] {
  const merged = [...rules];
  for (const d of llm) {
    if (!docIds.has(d.docId)) continue;
    if (merged.some((m) => m.docId === d.docId && m.type === d.type)) continue;
    merged.push(d);
  }
  return merged;
}

/**
 * Documents the rules parser couldn't read (e.g. a table-layout PDF invoice) are read by
 * Claude instead; only figures printed in the document survive. Logged per document.
 */
async function readUnparsedDocuments(ctx: AgentContext, rules: ExtractedFacts): Promise<{ facts: ExtractedFacts; gaps: string[] }> {
  const unread = unreadDocuments(ctx.documents, rules);
  if (unread.length === 0) return { facts: rules, gaps: [] };
  const extraction = await extractWithClaude(ctx.llm!, ctx.documents.map((d) => ({ title: d.title, kind: d.kind, content: d.content })));
  const merged = mergeFacts(ctx.documents, rules, extraction);
  for (const doc of unread) {
    const g = merged.grounded[doc.id];
    await ctx.log("evidence.facts_extracted", {
      docId: doc.id,
      title: doc.title,
      kind: doc.kind,
      source: merged.sources[doc.id] ?? "none",
      lines: g?.contract?.lines.length ?? g?.invoice?.lines.length ?? g?.delivery?.lines.length ?? 0,
      totalPence: g?.invoice?.totalPence ?? null,
      amountPence: g?.payment?.amountPence ?? null,
      rejected: g?.rejected.length ?? 0,
    });
  }
  return { facts: merged.facts, gaps: merged.gaps };
}

async function enhanceWithClaude(ctx: AgentContext, base: EvidenceOutput): Promise<EvidenceOutput> {
  const read = await readUnparsedDocuments(ctx, base.facts);
  const docs = ctx.documents
    .map((d) => `<document id="${d.id}" kind="${d.kind}" title="${d.title}">\n${d.content}\n</document>`)
    .join("\n");
  const result = await ctx.llm!.structured({
    schema: LlmEvidenceSchema,
    system: SYSTEM,
    prompt:
      `Creditor: ${ctx.caseFile.creditor}\nDebtor: ${ctx.caseFile.debtor}\n\n${docs}\n\n` +
      `Rule-based extraction already found these disputes: ${JSON.stringify(read.facts.disputes)}.\n` +
      "Return a 2-3 sentence evidential summary, any additional evidential gaps, and the complete list of debtor disputes.",
  });
  const docIds = new Set(ctx.documents.map((d) => d.id));
  const disputes = mergeDisputes(read.facts.disputes, result.disputes, docIds);
  const facts = { ...read.facts, disputes };
  return {
    summary: result.summary,
    items: ctx.documents.map((doc, i) => ({ ...base.items[i], facts: describeDocument(doc, facts) })),
    facts,
    // Recompute rule-based gaps against the merged facts so Claude-read documents count.
    gaps: Array.from(new Set([...findGaps(facts, ctx.documents), ...read.gaps, ...result.gaps])),
  };
}

export const evidenceAgent: Agent<EvidenceOutput> = {
  name: "evidence",
  title: "Evidence agent",
  async run(ctx) {
    await ctx.log("evidence.started", { documentCount: ctx.documents.length });
    for (const doc of ctx.documents) {
      await ctx.pace(0.25);
      await ctx.log("evidence.document_reviewed", {
        docId: doc.id,
        title: doc.title,
        kind: doc.kind,
        contentHash: sha256Hex(doc.content),
      });
    }
    const base = deterministicEvidence(ctx);
    if (!ctx.llm) return { output: base, engine: "deterministic" };
    try {
      return { output: await enhanceWithClaude(ctx, base), engine: "claude" };
    } catch (err) {
      await ctx.log("evidence.claude_fallback", { reason: errorMessage(err) });
      return { output: base, engine: "deterministic" };
    }
  },
};
