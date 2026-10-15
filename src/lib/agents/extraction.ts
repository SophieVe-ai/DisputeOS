// Claude-assisted fact extraction for real-world documents (table-layout invoices,
// prose contracts, free-text delivery notes and remittances) that the deterministic
// parser can't read. Claude only READS figures; it never computes them. Every amount
// and quantity it returns must literally appear in the source document ("grounding"),
// otherwise it is dropped and reported as an evidential gap. All arithmetic stays in
// the deterministic Reconciliation agent.
import { z } from "zod";
import { formatPence } from "../money";
import { DOC_KINDS, type CaseDocument, type ContractFacts, type DeliveryFacts, type DocKind, type ExtractedFacts, type InvoiceFacts, type PaymentFacts, type PricedLine, type QtyLine } from "../types";
import type { LlmClient } from "./llm";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// No numeric bounds in the API schema; values are validated in code below.
export const ExtractionSchema = z.object({
  creditor: z.string().nullable(),
  debtor: z.string().nullable(),
  debtorEmail: z.string().nullable(),
  documents: z.array(
    z.object({
      docIndex: z.number().int(),
      kind: z.enum(DOC_KINDS),
      reference: z.string().nullable(),
      date: z.string().nullable(),
      dueDate: z.string().nullable(),
      paymentTermsDays: z.number().int().nullable(),
      inspectionDays: z.number().int().nullable(),
      signedBy: z.string().nullable(),
      totalPence: z.number().int().nullable(),
      amountPaidPence: z.number().int().nullable(),
      lines: z.array(z.object({ item: z.string(), qty: z.number().int(), unitPricePence: z.number().int().nullable() })),
    }),
  ),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
type ExtractedDoc = Extraction["documents"][number];

const SYSTEM = `You extract facts from the documents of a UK B2B debt dispute for DisputeOS.
Read figures exactly as written; never calculate, infer or round anything. Rules:
- Money is integer pence (£1,450.00 → 145000). Only report amounts printed in that document.
- Dates are ISO YYYY-MM-DD (UK documents write day/month/year). Use null when absent.
- lines: one per product/service line. For contracts and invoices include the unit price; for delivery notes
  give the quantity actually delivered and unitPricePence null. Name the same product identically across
  documents, using the contract's wording when there is one.
- totalPence: an invoice's stated total due. amountPaidPence: the amount on a payment/remittance.
- paymentTermsDays / inspectionDays: from contract terms ("30 days from invoice" → 30).
- signedBy: who signed for or received a delivery.
- creditor is the supplier who is owed money; debtor is the customer who owes it.
Return one entry per document, using its docIndex.`;

export function buildExtractionPrompt(docs: { title: string; kind: DocKind; content: string }[]): string {
  return docs.map((d, i) => `<document docIndex="${i}" kind="${d.kind}" title="${d.title}">\n${d.content}\n</document>`).join("\n");
}

export async function extractWithClaude(llm: LlmClient, docs: { title: string; kind: DocKind; content: string }[]): Promise<Extraction> {
  return llm.structured({ schema: ExtractionSchema, system: SYSTEM, prompt: `${buildExtractionPrompt(docs)}\n\nExtract the facts from every document.` });
}

// ---------- Grounding: every figure must appear in the document text ----------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const appears = (text: string, token: string) => new RegExp(`(?<![\\d.,])${escapeRe(token)}(?![\\d]|[.,]\\d)`).test(text);

/** True if `pence` is printed in `text` (e.g. 145000 matches "£1,450.00", "1450.00" or "£1,450"). */
export function amountGrounded(text: string, pence: number): boolean {
  if (!Number.isInteger(pence) || pence < 0) return false;
  const fixed = (pence / 100).toFixed(2);
  const commas = (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const variants = new Set([fixed, commas]);
  if (pence % 100 === 0) {
    variants.add(String(pence / 100));
    variants.add((pence / 100).toLocaleString("en-GB"));
  }
  return [...variants].some((v) => appears(text, v));
}

/** True if the quantity is printed as a standalone number. Weak on purpose: quantities are low-risk. */
export function qtyGrounded(text: string, qty: number): boolean {
  return Number.isInteger(qty) && qty > 0 && appears(text, String(qty));
}

const isoOrNull = (d: string | null) => (d && ISO_DATE.test(d) ? d : null);
const positiveIntOrNull = (n: number | null) => (n !== null && Number.isInteger(n) && n > 0 ? n : null);

export interface GroundedDoc {
  kind: DocKind;
  contract?: ContractFacts;
  invoice?: InvoiceFacts;
  delivery?: DeliveryFacts;
  payment?: PaymentFacts;
  /** Human-readable notes about figures that were dropped because the document doesn't contain them. */
  rejected: string[];
}

/**
 * `checkQty` is off for contracts: they often write quantities in words ("two machines"),
 * and Reconciliation only uses a contract's unit prices, which are always grounded.
 */
function groundLines(doc: CaseDocument, lines: ExtractedDoc["lines"], priced: boolean, rejected: string[], checkQty = true) {
  const ok: PricedLine[] = [];
  const qtyOnly: QtyLine[] = [];
  for (const l of lines) {
    const item = l.item.trim();
    if (!item) continue;
    if (checkQty && !qtyGrounded(doc.content, l.qty)) {
      rejected.push(`“${doc.title}”: quantity ${l.qty} for ${item} is not in the document; line ignored.`);
      continue;
    }
    if (!priced) {
      qtyOnly.push({ item, qty: l.qty });
      continue;
    }
    if (l.unitPricePence === null || !amountGrounded(doc.content, l.unitPricePence)) {
      rejected.push(`“${doc.title}”: unit price for ${item} could not be found in the document; line ignored.`);
      continue;
    }
    ok.push({ item, qty: l.qty, unitPricePence: l.unitPricePence });
  }
  return { priced: ok, qty: qtyOnly };
}

/** Converts one extracted document into parser-compatible facts, keeping only grounded figures. */
export function groundDocument(doc: CaseDocument, x: ExtractedDoc): GroundedDoc {
  const rejected: string[] = [];
  const kind = doc.kind;
  switch (kind) {
    case "contract": {
      const { priced } = groundLines(doc, x.lines, true, rejected, false);
      return { kind, rejected, contract: { docId: doc.id, reference: x.reference, date: isoOrNull(x.date) ?? doc.docDate, paymentTermsDays: positiveIntOrNull(x.paymentTermsDays), inspectionDays: positiveIntOrNull(x.inspectionDays), lines: priced } };
    }
    case "invoice": {
      const { priced } = groundLines(doc, x.lines, true, rejected);
      const computed = priced.reduce((s, l) => s + l.qty * l.unitPricePence, 0);
      let total = x.totalPence;
      if (total !== null && !amountGrounded(doc.content, total)) {
        rejected.push(`“${doc.title}”: stated total ${formatPence(total)} is not in the document; using the sum of its lines.`);
        total = null;
      }
      if (total !== null && priced.length > 0 && total !== computed) {
        rejected.push(`“${doc.title}”: lines add up to ${formatPence(computed)} but the invoice states ${formatPence(total)}. Check the invoice.`);
      }
      return { kind, rejected, invoice: { docId: doc.id, number: x.reference ?? doc.title, date: isoOrNull(x.date) ?? doc.docDate, dueDate: isoOrNull(x.dueDate), lines: priced, totalPence: total ?? computed } };
    }
    case "delivery_note": {
      const { qty } = groundLines(doc, x.lines, false, rejected);
      return { kind, rejected, delivery: { docId: doc.id, date: isoOrNull(x.date) ?? doc.docDate, signedBy: x.signedBy?.trim() || null, lines: qty } };
    }
    case "payment": {
      const amount = x.amountPaidPence;
      if (amount === null || !amountGrounded(doc.content, amount)) {
        if (amount !== null) rejected.push(`“${doc.title}”: payment of ${formatPence(amount)} is not in the document; ignored.`);
        return { kind, rejected };
      }
      return { kind, rejected, payment: { docId: doc.id, date: isoOrNull(x.date) ?? doc.docDate, amountPence: amount, reference: x.reference } };
    }
    default:
      return { kind, rejected };
  }
}

// ---------- Merge: rules first, Claude only where the rules found nothing ----------

export type FactSource = "rules" | "claude" | "none";

export interface MergedFacts {
  facts: ExtractedFacts;
  sources: Record<string, FactSource>;
  gaps: string[];
  grounded: Record<string, GroundedDoc>;
}

/** Documents of a fact-bearing kind that the deterministic parser could not read. */
export function unreadDocuments(docs: readonly CaseDocument[], facts: ExtractedFacts): CaseDocument[] {
  return docs.filter((d) => {
    switch (d.kind) {
      case "contract": return facts.contract?.docId !== d.id || facts.contract.lines.length === 0;
      case "invoice": return (facts.invoices.find((i) => i.docId === d.id)?.lines.length ?? 0) === 0;
      case "delivery_note": return (facts.deliveries.find((x) => x.docId === d.id)?.lines.length ?? 0) === 0;
      case "payment": return !facts.payments.some((p) => p.docId === d.id);
      default: return false;
    }
  });
}

export function mergeFacts(docs: readonly CaseDocument[], rules: ExtractedFacts, extraction: Extraction): MergedFacts {
  const unread = new Set(unreadDocuments(docs, rules).map((d) => d.id));
  const sources: Record<string, FactSource> = {};
  const grounded: Record<string, GroundedDoc> = {};
  const gaps: string[] = [];
  let contract = rules.contract && rules.contract.lines.length > 0 ? rules.contract : null;
  const invoices = rules.invoices.filter((i) => !unread.has(i.docId));
  const deliveries = rules.deliveries.filter((d) => !unread.has(d.docId));
  const payments = [...rules.payments];

  docs.forEach((doc, index) => {
    if (!["contract", "invoice", "delivery_note", "payment"].includes(doc.kind)) return;
    if (!unread.has(doc.id)) {
      sources[doc.id] = "rules";
      return;
    }
    const x = extraction.documents.find((e) => e.docIndex === index);
    if (!x) {
      sources[doc.id] = "none";
      return;
    }
    const g = groundDocument(doc, x);
    grounded[doc.id] = g;
    gaps.push(...g.rejected);
    const found = Boolean(g.contract?.lines.length || g.invoice?.lines.length || g.invoice?.totalPence || g.delivery?.lines.length || g.payment);
    sources[doc.id] = found ? "claude" : "none";
    if (g.contract && !contract) contract = g.contract;
    if (g.invoice) invoices.push(g.invoice);
    if (g.delivery) deliveries.push(g.delivery);
    if (g.payment) payments.push(g.payment);
  });

  // Keep a rules-parsed contract with no priced lines (it may still carry terms) if nothing better was found.
  contract ??= rules.contract;
  return { facts: { contract, invoices, deliveries, payments, disputes: rules.disputes }, sources, gaps, grounded };
}
