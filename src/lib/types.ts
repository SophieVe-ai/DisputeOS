// Core domain types for DisputeOS. All money is stored as integer pence.

export const DOC_KINDS = [
  "contract",
  "invoice",
  "delivery_note",
  "payment",
  "correspondence",
  "other",
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export type CaseStatus =
  | "open"
  | "in_review"
  | "awaiting_approval"
  | "awaiting_response"
  | "resolved"
  | "escalated"
  | "closed";

export interface CaseDocument {
  id: string;
  caseId: string;
  kind: DocKind;
  title: string;
  content: string;
  docDate: string | null;
}

export interface DisputeCase {
  id: string;
  reference: string;
  title: string;
  creditor: string;
  debtor: string;
  debtorEmail: string | null;
  claimedAmountPence: number;
  status: CaseStatus;
  summary: string;
  createdAt: string;
}

// ---------- Extracted facts ----------

export interface PricedLine {
  item: string;
  qty: number;
  unitPricePence: number;
}

export interface QtyLine {
  item: string;
  qty: number;
}

export interface ContractFacts {
  docId: string;
  reference: string | null;
  date: string | null;
  paymentTermsDays: number | null;
  inspectionDays: number | null;
  lines: PricedLine[];
}

export interface InvoiceFacts {
  docId: string;
  number: string;
  date: string | null;
  dueDate: string | null;
  lines: PricedLine[];
  totalPence: number;
}

export interface DeliveryFacts {
  docId: string;
  date: string | null;
  signedBy: string | null;
  lines: QtyLine[];
}

export interface PaymentFacts {
  docId: string;
  date: string | null;
  amountPence: number;
  reference: string | null;
}

export const DISPUTE_TYPES = [
  "damage",
  "shortfall",
  "quality",
  "pricing",
  "non_receipt",
  "other",
] as const;
export type DisputeType = (typeof DISPUTE_TYPES)[number];

export interface DisputeFacts {
  docId: string;
  date: string | null;
  type: DisputeType;
  item: string | null;
  qty: number | null;
  claim: string;
}

export interface ExtractedFacts {
  contract: ContractFacts | null;
  invoices: InvoiceFacts[];
  deliveries: DeliveryFacts[];
  payments: PaymentFacts[];
  disputes: DisputeFacts[];
}

// ---------- Agent outputs ----------

export interface EvidenceItem {
  docId: string;
  docTitle: string;
  kind: DocKind;
  relevance: "primary" | "supporting";
  facts: string[];
}

export interface EvidenceOutput {
  summary: string;
  items: EvidenceItem[];
  facts: ExtractedFacts;
  gaps: string[];
}

export interface ReconciliationLine {
  item: string;
  contractUnitPence: number | null;
  invoicedQty: number;
  invoicedUnitPence: number;
  deliveredQty: number;
  invoicedPence: number;
  supportedPence: number;
  variancePence: number;
  flags: string[];
}

export interface ReconciliationOutput {
  summary: string;
  lines: ReconciliationLine[];
  invoicedTotalPence: number;
  paidPence: number;
  outstandingPence: number;
  supportedPrincipalPence: number;
  overchargePence: number;
  shortDeliveryPence: number;
  daysOverdue: number;
  interestPence: number;
  compensationPence: number;
  totalRecoverablePence: number;
}

export type ChallengeVerdict = "upheld" | "partially_upheld" | "rebutted";
export type Severity = "low" | "medium" | "high";

export interface Challenge {
  id: string;
  title: string;
  argument: string;
  severity: Severity;
  basisDocId: string | null;
  verdict: ChallengeVerdict;
  rebuttal: string;
  /** Additional deduction from the reconciled principal if the challenge stands. */
  impactPence: number;
  source: "rules" | "claude";
}

export type Recommendation =
  | "pursue_full"
  | "pursue_reduced"
  | "negotiate"
  | "write_off";

export interface ChallengeOutput {
  summary: string;
  challenges: Challenge[];
  deductionsPence: number;
  defensiblePrincipalPence: number;
  confidence: number;
  recommendation: Recommendation;
}

export const PROPOSAL_KINDS = [
  "send_letter_before_action",
  "offer_settlement",
  "issue_credit_note",
  "prepare_court_claim",
  "write_off",
  // Follow-up actions drafted by the Negotiation agent after the debtor replies or a deadline lapses.
  "send_reply",
  "send_reminder",
  "accept_offer",
  "escalate_court_claim",
  "close_case",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export interface ProposalDraft {
  kind: ProposalKind;
  title: string;
  rationale: string;
  amountPence: number;
  documentTitle: string;
  documentBody: string;
  /** Days to wait for a reply once this is sent; null when no reply is expected. */
  followUpDays?: number | null;
}

export interface ResolutionOutput {
  summary: string;
  strategy: string;
  interestPence: number;
  compensationPence: number;
  proposals: ProposalDraft[];
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "executed";

export interface Proposal extends ProposalDraft {
  id: string;
  /** The Negotiation agent turn that drafted this proposal; null for the initial pipeline. */
  turnId: string | null;
  followUpDays: number | null;
  runId: string;
  caseId: string;
  status: ProposalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedAt: string | null;
  executionResult: string | null;
}

// ---------- Runs ----------

export const AGENT_NAMES = [
  "evidence",
  "reconciliation",
  "challenge",
  "resolution",
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_response"
  | "completed"
  | "failed";

export type Engine = "claude" | "deterministic";

export interface Run {
  id: string;
  caseId: string;
  status: RunStatus;
  stepIndex: number;
  attempts: number;
  leaseUntil: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface RunStep {
  runId: string;
  stepIndex: number;
  agent: AgentName;
  status: StepStatus;
  engine: Engine | null;
  output: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

// ---------- Negotiation (long-running follow-up) ----------

export type MessageDirection = "outbound" | "inbound";

export interface CorrespondenceMessage {
  id: string;
  caseId: string;
  runId: string;
  direction: MessageDirection;
  sender: string;
  subject: string;
  body: string;
  proposalId: string | null;
  sha256: string;
  createdAt: string;
}

export const REPLY_INTENTS = [
  "paid",
  "counter_offer",
  "promise_to_pay",
  "dispute",
  "refusal",
  "request_info",
  "acknowledgement",
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export interface ReplyAnalysis {
  intent: ReplyIntent;
  /** The figure the intent is about (offered, paid), grounded in the reply text. */
  amountPence: number | null;
  /** A promised payment date (ISO), grounded in the reply text. */
  promisedDate: string | null;
  disputeTypes: DisputeType[];
  quote: string;
  source: "rules" | "claude";
  /** Figures or dates Claude returned that do not appear in the reply and were discarded. */
  rejected: number;
}

export const NEGOTIATION_DECISIONS = [
  "accept_offer",
  "counter_offer",
  "confirm_promise",
  "ask_for_date",
  "chase_balance",
  "request_remittance",
  "close_settled",
  "rebut_dispute",
  "hold_and_review",
  "send_evidence",
  "remind",
  "escalate",
  "wait",
] as const;
export type NegotiationDecision = (typeof NEGOTIATION_DECISIONS)[number];

export type WakeupKind = "reply" | "deadline";
export type WakeupStatus = "scheduled" | "processing" | "done" | "cancelled" | "failed";

export interface NegotiationOutput {
  trigger: WakeupKind;
  summary: string;
  analysis: ReplyAnalysis | null;
  /** Lowest figure currently on the table (what the debtor must pay to settle). */
  demandPence: number;
  /** Defensible principal: the agent never proposes settling below it. */
  floorPence: number;
  decision: NegotiationDecision;
  rationale: string;
  proposals: ProposalDraft[];
}

export interface Wakeup {
  id: string;
  runId: string;
  caseId: string;
  kind: WakeupKind;
  messageId: string | null;
  reason: string;
  dueAt: string;
  status: WakeupStatus;
  attempts: number;
  leaseUntil: string | null;
  engine: Engine | null;
  output: NegotiationOutput | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}
