import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import type { Proposal, ProposalDraft, ProposalKind, ProposalStatus } from "../types";

interface ProposalRow {
  id: string;
  run_id: string;
  case_id: string;
  kind: ProposalKind;
  title: string;
  rationale: string;
  amount_pence: number;
  document_title: string;
  document_body: string;
  status: ProposalStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
  execution_result: string | null;
}

const toProposal = (r: ProposalRow): Proposal => ({
  id: r.id,
  runId: r.run_id,
  caseId: r.case_id,
  kind: r.kind,
  title: r.title,
  rationale: r.rationale,
  amountPence: r.amount_pence,
  documentTitle: r.document_title,
  documentBody: r.document_body,
  status: r.status,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
  executedAt: r.executed_at,
  executionResult: r.execution_result,
});

export function insertProposals(runId: string, caseId: string, drafts: ProposalDraft[]): Proposal[] {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO proposals (id, run_id, case_id, kind, title, rationale, amount_pence, document_title, document_body, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  );
  const ids = drafts.map(() => randomUUID());
  db.transaction(() => {
    drafts.forEach((d, i) => stmt.run(ids[i], runId, caseId, d.kind, d.title, d.rationale, d.amountPence, d.documentTitle, d.documentBody));
  })();
  return ids.map((id) => getProposal(id)!);
}

export function getProposal(id: string): Proposal | null {
  const row = getDb().prepare("SELECT * FROM proposals WHERE id = ?").get(id) as ProposalRow | undefined;
  return row ? toProposal(row) : null;
}

export function listProposals(runId: string): Proposal[] {
  return (getDb().prepare("SELECT * FROM proposals WHERE run_id = ? ORDER BY rowid").all(runId) as ProposalRow[]).map(toProposal);
}

export function countPendingProposals(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'").get() as { n: number }).n;
}

export function recordDecision(id: string, status: "approved" | "rejected", by: string, note: string | null, at: string): void {
  getDb()
    .prepare("UPDATE proposals SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(status, by, note, at, id);
}

export function recordExecution(id: string, result: string, at: string): void {
  getDb()
    .prepare("UPDATE proposals SET status = 'executed', executed_at = ?, execution_result = ? WHERE id = ? AND status = 'approved'")
    .run(at, result, id);
}
