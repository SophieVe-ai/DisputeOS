// Deterministic document parser. Understands the plain-text conventions used by
// DisputeOS document intake (key: value fields + "- item | qty N | £price" lines)
// and keyword-based dispute detection for free-text correspondence.
import { parsePounds } from "./money";
import type {
  CaseDocument,
  ContractFacts,
  DeliveryFacts,
  DisputeFacts,
  DisputeType,
  ExtractedFacts,
  InvoiceFacts,
  PaymentFacts,
  PricedLine,
  QtyLine,
} from "./types";

export interface PartyContext {
  creditor: string;
  debtor: string;
}

const ISO_DATE = /(\d{4}-\d{2}-\d{2})/;
const LINE_RE =
  /^\s*[-•*]\s*(.+?)\s*\|\s*qty\s*:?\s*(\d+)\s*(?:\|\s*(£?\s?[\d,]+(?:\.\d{1,2})?))?/i;

export function field(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im");
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function dateField(text: string, labels: string[]): string | null {
  const raw = field(text, labels);
  const m = raw?.match(ISO_DATE);
  return m ? m[1] : null;
}

function moneyField(text: string, labels: string[]): number | null {
  const raw = field(text, labels);
  if (!raw) return null;
  const m = raw.match(/£?\s?[\d,]+(?:\.\d{1,2})?/);
  return m ? parsePounds(m[0]) : null;
}

function daysField(text: string, labels: string[]): number | null {
  const raw = field(text, labels);
  const m = raw?.match(/(\d+)\s*(?:working\s+|calendar\s+)?days?/i);
  return m ? Number(m[1]) : null;
}

export function parseLines(text: string): { priced: PricedLine[]; qty: QtyLine[] } {
  const priced: PricedLine[] = [];
  const qty: QtyLine[] = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(LINE_RE);
    if (!m) continue;
    const item = m[1].trim();
    const n = Number(m[2]);
    qty.push({ item, qty: n });
    const price = m[3] ? parsePounds(m[3]) : null;
    if (price !== null) priced.push({ item, qty: n, unitPricePence: price });
  }
  return { priced, qty };
}

export function parseContract(doc: CaseDocument): ContractFacts {
  const { priced } = parseLines(doc.content);
  return {
    docId: doc.id,
    reference: field(doc.content, ["Contract reference", "Reference", "Agreement ref"]),
    date: dateField(doc.content, ["Contract date", "Date"]) ?? doc.docDate,
    paymentTermsDays: daysField(doc.content, ["Payment terms"]),
    inspectionDays: daysField(doc.content, ["Inspection period", "Inspection"]),
    lines: priced,
  };
}

export function parseInvoice(doc: CaseDocument): InvoiceFacts {
  const { priced } = parseLines(doc.content);
  const computed = priced.reduce((s, l) => s + l.qty * l.unitPricePence, 0);
  return {
    docId: doc.id,
    number: field(doc.content, ["Invoice number", "Invoice no", "Invoice #"]) ?? doc.title,
    date: dateField(doc.content, ["Invoice date", "Date"]) ?? doc.docDate,
    dueDate: dateField(doc.content, ["Due date", "Payment due"]),
    lines: priced,
    totalPence: moneyField(doc.content, ["Total due", "Total", "Amount due"]) ?? computed,
  };
}

export function parseDelivery(doc: CaseDocument): DeliveryFacts {
  const { qty } = parseLines(doc.content);
  return {
    docId: doc.id,
    date: dateField(doc.content, ["Delivery date", "Delivered", "Date"]) ?? doc.docDate,
    signedBy: field(doc.content, ["Signed by", "Received by", "POD signed"]),
    lines: qty,
  };
}

export function parsePayment(doc: CaseDocument): PaymentFacts | null {
  const amount = moneyField(doc.content, ["Amount paid", "Amount", "Payment amount"]);
  if (amount === null) return null;
  return {
    docId: doc.id,
    date: dateField(doc.content, ["Payment date", "Date"]) ?? doc.docDate,
    amountPence: amount,
    reference: field(doc.content, ["Reference", "Payment reference"]),
  };
}

const DISPUTE_PATTERNS: { type: DisputeType; re: RegExp }[] = [
  { type: "non_receipt", re: /\b(never received|not received|did not receive|didn't receive|no delivery)\b/i },
  { type: "damage", re: /\b(damaged|broken|cracked|scratched|dented|defective)\b/i },
  { type: "shortfall", re: /\b(short[- ]delivered|shortfall|missing|only received)\b/i },
  { type: "pricing", re: /\b(overcharg\w*|wrong price|more than (?:the )?agreed|price (?:is|was) wrong|agreed (?:rate|price))\b/i },
  { type: "quality", re: /\b(poor quality|substandard|not fit for purpose|poor finish)\b/i },
];

const QTY_NEAR_KEYWORD =
  /(\d+)\s+(?:of\s+the\s+)?(?:[a-z-]+\s+){0,4}?(?:units?|items?|pieces?|boxes|cases|sections?|panels?)?\s*(?:were|was|are|arrived|have been)?\s*(?:damaged|broken|cracked|scratched|dented|defective|missing)/i;

function authoredBy(text: string, party: string): boolean {
  const from = field(text, ["From"]);
  if (!from) return false;
  const key = party.toLowerCase().split(/\s+/)[0];
  return from.toLowerCase().includes(key);
}

export function detectDisputes(
  doc: CaseDocument,
  parties: PartyContext,
  knownItems: string[],
): DisputeFacts[] {
  const text = doc.content;
  // Chasers from the creditor are evidence of demand, not a dispute raised by the debtor.
  if (authoredBy(text, parties.creditor) && !authoredBy(text, parties.debtor)) return [];
  const date = dateField(text, ["Date", "Sent"]) ?? doc.docDate;
  const lower = text.toLowerCase();
  const item = knownItems.find((i) => lower.includes(i.toLowerCase())) ?? null;
  const qtyMatch = text.match(QTY_NEAR_KEYWORD);
  const results: DisputeFacts[] = [];
  for (const { type, re } of DISPUTE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const sentence = extractSentence(text, m.index ?? 0);
    results.push({
      docId: doc.id,
      date,
      type,
      item,
      qty: type === "damage" || type === "shortfall" ? (qtyMatch ? Number(qtyMatch[1]) : null) : null,
      claim: sentence,
    });
  }
  return results;
}

function extractSentence(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index), text.lastIndexOf("\n", index)) + 1;
  const endDot = text.indexOf(".", index);
  const end = endDot === -1 ? text.length : endDot + 1;
  return text.slice(start, end).trim().slice(0, 280);
}

export function extractFacts(docs: CaseDocument[], parties: PartyContext): ExtractedFacts {
  const contractDoc = docs.find((d) => d.kind === "contract");
  const contract = contractDoc ? parseContract(contractDoc) : null;
  const invoices = docs.filter((d) => d.kind === "invoice").map(parseInvoice);
  const deliveries = docs.filter((d) => d.kind === "delivery_note").map(parseDelivery);
  const payments = docs
    .filter((d) => d.kind === "payment")
    .map(parsePayment)
    .filter((p): p is PaymentFacts => p !== null);
  const knownItems = [
    ...(contract?.lines.map((l) => l.item) ?? []),
    ...invoices.flatMap((i) => i.lines.map((l) => l.item)),
  ];
  const disputes = docs
    .filter((d) => d.kind === "correspondence")
    .flatMap((d) => detectDisputes(d, parties, knownItems));
  return { contract, invoices, deliveries, payments, disputes };
}
