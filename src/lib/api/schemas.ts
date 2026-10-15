import { z } from "zod";
import { DOC_KINDS } from "../types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DOCUMENTS = 25;
const MAX_DOC_CHARS = 20_000;

export const NewCaseSchema = z.object({
  title: z.string().trim().min(3).max(140),
  creditor: z.string().trim().min(2).max(140),
  debtor: z.string().trim().min(2).max(140),
  debtorEmail: z.email().max(200).nullable().default(null),
  claimedAmountPence: z.number().int().positive().max(10_000_000_000),
  summary: z.string().trim().max(1000).default(""),
  documents: z
    .array(
      z.object({
        kind: z.enum(DOC_KINDS),
        title: z.string().trim().min(1).max(140),
        content: z.string().trim().min(1).max(MAX_DOC_CHARS),
        docDate: z.string().regex(ISO_DATE).nullable().default(null),
      }),
    )
    .min(1)
    .max(MAX_DOCUMENTS),
});

const Person = z.string().trim().min(2).max(80).regex(/^[\p{L}\p{N} .'-]+$/u, "Use letters, numbers, spaces, . ' -");

export const StartRunSchema = z.object({ requestedBy: Person.default("operator") });

export const DecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  approver: Person,
  note: z.string().trim().max(500).nullable().default(null),
  pin: z.string().max(32).nullable().default(null),
});

export const VerifySchema = z.object({ caseId: z.string().max(100).optional() });
export const TamperSchema = z.object({ caseId: z.string().min(1).max(100) });

const Sender = z.string().trim().min(2).max(120).regex(/^[\p{L}\p{N} .,'&@()_+-]+$/u, "Use letters, numbers, spaces and . , ' & @ ( ) _ + -");

/** An inbound reply from the debtor: posted by the UI, or by an inbound-email webhook. */
export const ReplySchema = z.object({
  from: Sender,
  subject: z.string().trim().min(1).max(200).nullable().default(null),
  body: z.string().trim().min(1).max(MAX_DOC_CHARS),
});

export const CloseEngagementSchema = z.object({ closedBy: Person });
export const FastForwardSchema = z.object({ caseId: z.string().min(1).max(100) });
