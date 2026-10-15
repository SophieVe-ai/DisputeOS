// Deterministic intake: classifies each uploaded document and infers the case header
// (parties, claimed balance) so an upload can go straight into the agent pipeline.
import { formatPence } from "../money";
import { field, parseContract, parseDelivery, parseInvoice, parsePayment } from "../parser";
import type { CaseDocument, DocKind } from "../types";
import { extensionOf } from "./extract";

export interface ClassifiedDocument {
  filename: string;
  kind: DocKind;
  title: string;
  docDate: string | null;
  content: string;
  confidence: number;
}

export interface InferredCase {
  title: string;
  creditor: string;
  debtor: string;
  debtorEmail: string | null;
  claimedAmountPence: number | null;
  summary: string;
}

type Scored = Exclude<DocKind, "other">;

const SIGNALS: Record<Scored, { content: RegExp[]; name: RegExp }> = {
  contract: {
    content: [/^\s*(contract reference|agreement ref)\s*:/im, /^\s*payment terms\s*:/im, /\b(agreement|quotation|terms and conditions)\b/i, /^\s*(supplier|customer)\s*:/im],
    name: /contract|agreement|quote|quotation|terms|po\b|purchase/i,
  },
  invoice: {
    content: [/^\s*invoice (number|no|#)\s*:/im, /^\s*(total due|amount due)\s*:/im, /^\s*due date\s*:/im, /\binvoice\b/i],
    name: /invoice|inv[-_ ]?\d/i,
  },
  delivery_note: {
    content: [/^\s*delivery date\s*:/im, /^\s*(signed by|received by|pod signed)\s*:/im, /\b(delivery note|proof of delivery|dispatch note)\b/i],
    name: /deliver|pod\b|dispatch|dn[-_ ]?\d/i,
  },
  payment: {
    content: [/^\s*amount paid\s*:/im, /^\s*payment date\s*:/im, /\b(remittance|bacs|payment received)\b/i],
    name: /remit|payment|receipt|bacs/i,
  },
  correspondence: {
    content: [/^\s*from\s*:/im, /^\s*subject\s*:/im, /^\s*to\s*:/im, /\b(dear|regards|thanks|hi )\b/i],
    name: /email|letter|mail|correspondence|\.eml$/i,
  },
};

const CONTENT_WEIGHT = 2;
const NAME_WEIGHT = 3;
const MIN_SCORE = 2;

export function classifyKind(filename: string, text: string): { kind: DocKind; confidence: number } {
  const scores = (Object.keys(SIGNALS) as Scored[]).map((kind) => {
    const s = SIGNALS[kind];
    const hits = s.content.filter((re) => re.test(text)).length;
    return { kind, score: hits * CONTENT_WEIGHT + (s.name.test(filename) ? NAME_WEIGHT : 0) };
  });
  if (extensionOf(filename) === "eml") scores.find((s) => s.kind === "correspondence")!.score += NAME_WEIGHT * 2;
  scores.sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (best.score < MIN_SCORE) return { kind: "other", confidence: 0.3 };
  const margin = (best.score - (second?.score ?? 0)) / best.score;
  return { kind: best.kind, confidence: Math.round(Math.min(0.99, 0.55 + margin * 0.45) * 100) / 100 };
}

const MAX_HEADING_CHARS = 60;

const humanFilename = (filename: string) =>
  filename.replace(/\.[^.]+$/, "").replace(/^\d+[\s_-]+/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

function asDoc(kind: DocKind, content: string): CaseDocument {
  return { id: "preview", caseId: "preview", kind, title: "", content, docDate: null };
}

/** "DELIVERY NOTE DN-8804" → "Delivery note DN-8804"; null if the first line isn't a heading. */
export function headingTitle(text: string): string | null {
  const first = text.split("\n").map((l) => l.trim()).find(Boolean);
  if (!first || first.includes(":") || first.length > MAX_HEADING_CHARS || first !== first.toUpperCase()) return null;
  const words = first.split(/\s+/).map((w) => (/\d/.test(w) ? w : w.toLowerCase()));
  const joined = words.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function titleFor(kind: DocKind, filename: string, text: string): string {
  const fallback = headingTitle(text) ?? humanFilename(filename);
  switch (kind) {
    case "invoice": {
      const n = field(text, ["Invoice number", "Invoice no", "Invoice #"]);
      return n ? `Invoice ${n}` : fallback;
    }
    case "contract": {
      const ref = field(text, ["Contract reference", "Agreement ref", "Reference"]);
      return ref ? `Contract ${ref}` : fallback;
    }
    case "correspondence": {
      const subject = field(text, ["Subject"]);
      const from = field(text, ["From"])?.replace(/<[^>]*>/g, "").trim();
      return subject ? `${subject}${from ? ` — ${from.split("(")[0].trim()}` : ""}`.slice(0, 140) : fallback;
    }
    default:
      return fallback;
  }
}

function dateFor(kind: DocKind, text: string): string | null {
  const doc = asDoc(kind, text);
  switch (kind) {
    case "contract": return parseContract(doc).date;
    case "invoice": return parseInvoice(doc).date;
    case "delivery_note": return parseDelivery(doc).date;
    case "payment": return parsePayment(doc)?.date ?? null;
    default: return field(text, ["Date", "Sent"])?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  }
}

export function classifyDocument(filename: string, text: string): ClassifiedDocument {
  const { kind, confidence } = classifyKind(filename, text);
  return { filename, kind, title: titleFor(kind, filename, text).slice(0, 140), docDate: dateFor(kind, text), content: text, confidence };
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const companyKey = (name: string) => name.toLowerCase().split(/\s+/)[0] ?? "";

export function inferCase(docs: ClassifiedDocument[]): InferredCase {
  const text = (kind: DocKind) => docs.filter((d) => d.kind === kind).map((d) => d.content);
  const firstField = (kind: DocKind, labels: string[]) => text(kind).map((t) => field(t, labels)).find(Boolean) ?? null;

  const creditor = firstField("contract", ["Supplier", "Seller", "Contractor"]) ?? firstField("invoice", ["From", "Supplier", "Seller"]) ?? "";
  const debtor =
    firstField("contract", ["Customer", "Buyer", "Client"]) ?? firstField("invoice", ["Bill to", "Customer", "To"]) ?? firstField("payment", ["From"]) ?? "";

  const debtorEmail = debtor
    ? text("correspondence")
        .map((t) => field(t, ["From"]) ?? "")
        .filter((from) => from.toLowerCase().includes(companyKey(debtor)))
        .map((from) => from.match(EMAIL)?.[0] ?? null)
        .find(Boolean) ?? null
    : null;

  const invoices = docs.filter((d) => d.kind === "invoice").map((d) => parseInvoice(asDoc("invoice", d.content)));
  const invoiced = invoices.reduce((s, i) => s + i.totalPence, 0);
  const paid = docs
    .filter((d) => d.kind === "payment")
    .map((d) => parsePayment(asDoc("payment", d.content))?.amountPence ?? 0)
    .reduce((s, n) => s + n, 0);
  const claimed = invoiced > 0 ? Math.max(0, invoiced - paid) : null;

  const subject = invoices[0]?.lines[0]?.item ?? parseContract(asDoc("contract", text("contract")[0] ?? "")).lines[0]?.item ?? "Unpaid invoice";
  const debtorShort = debtor.replace(/\b(ltd|limited|plc|llp|inc)\.?$/i, "").trim();
  return {
    title: `${subject}${debtorShort ? ` — ${debtorShort}` : ""}`.slice(0, 140),
    creditor,
    debtor,
    debtorEmail,
    claimedAmountPence: claimed && claimed > 0 ? claimed : null,
    summary:
      invoiced > 0
        ? `Balance of ${formatPence(Math.max(0, invoiced - paid))} unpaid on ${formatPence(invoiced)} invoiced${paid > 0 ? ` after ${formatPence(paid)} received` : ""}. Opened from ${docs.length} uploaded document(s).`
        : `Opened from ${docs.length} uploaded document(s).`,
  };
}
