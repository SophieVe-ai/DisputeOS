// Reads a reply from the debtor and works out what they are saying: paying, promising,
// offering, disputing, refusing or asking for something. Rules first; Claude (when
// configured) reads free text, but every figure and date it returns must appear in the reply.
import { z } from "zod";
import type { LlmClient } from "../agents/llm";
import { parsePounds } from "../money";
import { DISPUTE_PATTERNS } from "../parser";
import { DISPUTE_TYPES, REPLY_INTENTS, type DisputeType, type ReplyAnalysis, type ReplyIntent } from "../types";

const AMOUNT_RE = /£\s?\d[\d,]*(?:\.\d{1,2})?/g;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MAX_QUOTE_CHARS = 240;

/** Ordered by priority: the first intent whose pattern matches wins. */
const INTENT_PATTERNS: { intent: Exclude<ReplyIntent, "acknowledgement">; re: RegExp; needsAmount?: boolean }[] = [
  { intent: "paid", re: /\b(?:have|has|had)\s+(?:now\s+|just\s+|today\s+)?(?:paid|settled|transferred|sent (?:the |a )?payment|made (?:the |a |full )?payment)\b|\bpayment (?:has been|was) (?:made|sent|transferred)\b|\bpaid in full\b|\bremittance (?:advice|attached)\b/i },
  { intent: "counter_offer", re: /\b(?:offer|propose|prepared to pay|willing to pay|settle (?:this |the matter )?(?:for|at)|full and final settlement)\b/i, needsAmount: true },
  { intent: "promise_to_pay", re: /\b(?:will (?:pay|settle|transfer|make (?:the |a |full )?payment)|payment will be (?:made|sent)|(?:pay|paid) (?:you )?(?:by|on|before)|arrange (?:the )?payment)\b/i },
  { intent: "dispute", re: /\b(?:dispute|disputing|contest|damaged|broken|defective|short[- ]delivered|missing|never received|not received|overcharg\w*|wrong price|poor quality|substandard)\b/i },
  { intent: "refusal", re: /\b(?:will not|won't|refuse to|decline to|do not intend to|have no intention of)\s+(?:pay|settle)\b|\breject (?:your|the) (?:claim|demand)\b/i },
  { intent: "request_info", re: /\b(?:please (?:send|provide|forward|supply)|copy of|proof of delivery|\bPOD\b|can you (?:send|provide)|statement of account|breakdown)\b/i },
];

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function amountsIn(text: string): number[] {
  return [...text.matchAll(AMOUNT_RE)].map((m) => parsePounds(m[0])).filter((n): n is number => n !== null && n > 0);
}

/** Finds the first date in the text: ISO, dd/mm/yyyy, or "30 October [2026]". Year defaults to `asOf`'s, rolling forward. */
export function findDate(text: string, asOf: string): { iso: string; written: string } | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { iso: iso[0], written: iso[0] };
  const uk = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (uk) return { iso: toIso(Number(uk[3]), Number(uk[2]), Number(uk[1])), written: uk[0] };
  const named = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})(?:\\s+(\\d{4}))?\\b`, "i"));
  if (!named) return null;
  const month = MONTHS.indexOf(named[2].toLowerCase()) + 1;
  const day = Number(named[1]);
  if (named[3]) return { iso: toIso(Number(named[3]), month, day), written: named[0] };
  const year = Number(asOf.slice(0, 4));
  const candidate = toIso(year, month, day);
  return { iso: candidate < asOf ? toIso(year + 1, month, day) : candidate, written: named[0] };
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function disputeTypesIn(text: string): DisputeType[] {
  const types = DISPUTE_PATTERNS.filter(({ re }) => re.test(text)).map(({ type }) => type);
  return types.length ? types : /\bdisput\w*|contest\b/i.test(text) ? ["other"] : [];
}

const clip = (s: string) => (s.length > MAX_QUOTE_CHARS ? `${s.slice(0, MAX_QUOTE_CHARS - 1)}…` : s);

/** Deterministic reading of a reply. */
export function classifyReplyRules(text: string, asOf: string): ReplyAnalysis {
  const all = sentences(text);
  const anyAmount = amountsIn(text);
  for (const { intent, re, needsAmount } of INTENT_PATTERNS) {
    const sentence = all.find((s) => re.test(s));
    if (!sentence) continue;
    const local = amountsIn(sentence);
    if (needsAmount && local.length === 0) continue;
    return {
      intent,
      amountPence: intent === "paid" || intent === "counter_offer" ? (local[0] ?? anyAmount[0] ?? null) : null,
      promisedDate: intent === "promise_to_pay" ? (findDate(sentence, asOf) ?? findDate(text, asOf))?.iso ?? null : null,
      disputeTypes: intent === "dispute" || intent === "refusal" ? disputeTypesIn(text) : [],
      quote: clip(sentence),
      source: "rules",
      rejected: 0,
    };
  }
  return { intent: "acknowledgement", amountPence: null, promisedDate: null, disputeTypes: [], quote: clip(all[0] ?? ""), source: "rules", rejected: 0 };
}

const ClaudeReplySchema = z.object({
  intent: z.enum(REPLY_INTENTS),
  amountAsWritten: z.string().nullable(),
  dateAsWritten: z.string().nullable(),
  promisedDateIso: z.string().nullable(),
  disputeTypes: z.array(z.enum(DISPUTE_TYPES)),
  quote: z.string(),
});

const SYSTEM = `You are the Negotiation agent in DisputeOS, reading a reply from a debtor in a UK B2B invoice dispute.
Classify the reply's main intent:
- paid: they say they have already paid (some or all)
- counter_offer: they offer a specific lower sum to settle
- promise_to_pay: they commit to pay on or by a date
- dispute: they contest the debt or part of it (damage, shortfall, pricing, quality, non-receipt, other)
- refusal: they refuse to pay without giving reasons we can address
- request_info: they ask for documents or information before paying
- acknowledgement: anything else (holding replies, out-of-office)
Copy the relevant money figure EXACTLY as written (e.g. "£7,500.00") into amountAsWritten, and any promised date EXACTLY
as written into dateAsWritten with its ISO form in promisedDateIso. Use null when absent. Never compute or infer figures.
quote must be a sentence copied verbatim from the reply.`;

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Claude reading of a reply, with every returned figure and date checked against the text. */
export async function classifyReplyWithClaude(llm: LlmClient, text: string, asOf: string): Promise<ReplyAnalysis> {
  const raw = await llm.structured({ schema: ClaudeReplySchema, system: SYSTEM, prompt: `Today is ${asOf}.\n\nReply:\n"""\n${text}\n"""` });
  const haystack = normalise(text);
  const grounded = (s: string | null) => s !== null && s.trim() !== "" && haystack.includes(normalise(s));
  let rejected = 0;

  let amountPence: number | null = null;
  if (raw.amountAsWritten !== null) {
    const parsed = parsePounds(raw.amountAsWritten);
    if (grounded(raw.amountAsWritten) && parsed !== null && parsed > 0) amountPence = parsed;
    else rejected += 1;
  }
  let promisedDate: string | null = null;
  if (raw.dateAsWritten !== null || raw.promisedDateIso !== null) {
    const iso = raw.promisedDateIso ?? "";
    if (grounded(raw.dateAsWritten) && /^\d{4}-\d{2}-\d{2}$/.test(iso)) promisedDate = iso;
    else rejected += 1;
  }
  return {
    intent: raw.intent,
    amountPence,
    promisedDate,
    disputeTypes: raw.disputeTypes,
    quote: clip(grounded(raw.quote) ? raw.quote : (sentences(text)[0] ?? "")),
    source: "claude",
    rejected,
  };
}
