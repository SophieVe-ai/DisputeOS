// When the deterministic intake can't classify a document or work out the parties and
// balance (typical for real PDFs), Claude fills the gaps. The balance is still built only
// from figures that appear in the documents (see agents/extraction.ts grounding).
import { formatPence } from "../money";
import { extractWithClaude, groundDocument } from "../agents/extraction";
import type { LlmClient } from "../agents/llm";
import type { CaseDocument } from "../types";
import type { ClassifiedDocument, InferredCase } from "./classify";

const LOW_CONFIDENCE = 0.6;
const CLAUDE_CONFIDENCE = 0.85;

export type PreviewDoc = ClassifiedDocument & { readBy: "rules" | "claude" };

export function needsClaude(docs: ClassifiedDocument[], inferred: InferredCase): boolean {
  return inferred.claimedAmountPence === null || !inferred.creditor || !inferred.debtor || docs.some((d) => d.kind === "other" || d.confidence < LOW_CONFIDENCE);
}

const asCaseDoc = (d: ClassifiedDocument, i: number): CaseDocument => ({ id: `preview-${i}`, caseId: "preview", kind: d.kind, title: d.title, content: d.content, docDate: d.docDate });

export async function inferWithClaude(llm: LlmClient, docs: ClassifiedDocument[], rules: InferredCase): Promise<{ documents: PreviewDoc[]; inferred: InferredCase }> {
  const extraction = await extractWithClaude(llm, docs.map((d) => ({ title: d.title, kind: d.kind, content: d.content })));
  const documents: PreviewDoc[] = docs.map((d, i) => {
    const x = extraction.documents.find((e) => e.docIndex === i);
    if (!x || (d.kind !== "other" && d.confidence >= LOW_CONFIDENCE) || x.kind === d.kind) return { ...d, readBy: "rules" };
    return { ...d, kind: x.kind, confidence: CLAUDE_CONFIDENCE, docDate: d.docDate ?? (x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null), readBy: "claude" };
  });

  let invoiced = 0;
  let paid = 0;
  let firstItem: string | null = null;
  documents.forEach((d, i) => {
    const x = extraction.documents.find((e) => e.docIndex === i);
    if (!x) return;
    const g = groundDocument(asCaseDoc(d, i), x);
    if (g.invoice) {
      invoiced += g.invoice.totalPence;
      firstItem ??= g.invoice.lines[0]?.item ?? null;
    }
    if (g.payment) paid += g.payment.amountPence;
  });

  const creditor = rules.creditor || extraction.creditor?.trim() || "";
  const debtor = rules.debtor || extraction.debtor?.trim() || "";
  const claimed = rules.claimedAmountPence ?? (invoiced > paid ? invoiced - paid : null);
  const debtorShort = debtor.replace(/\b(ltd|limited|plc|llp|inc)\.?$/i, "").trim();
  return {
    documents,
    inferred: {
      title: rules.claimedAmountPence === null && firstItem ? `${firstItem}${debtorShort ? ` — ${debtorShort}` : ""}`.slice(0, 140) : rules.title,
      creditor,
      debtor,
      debtorEmail: rules.debtorEmail ?? extraction.debtorEmail ?? null,
      claimedAmountPence: claimed,
      summary:
        rules.claimedAmountPence === null && invoiced > 0
          ? `Balance of ${formatPence(Math.max(0, invoiced - paid))} unpaid on ${formatPence(invoiced)} invoiced${paid > 0 ? ` after ${formatPence(paid)} received` : ""}. Opened from ${docs.length} uploaded document(s).`
          : rules.summary,
    },
  };
}
