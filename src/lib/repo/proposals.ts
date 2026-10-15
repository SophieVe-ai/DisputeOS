import { randomUUID } from "node:crypto";
import { getDb, transaction } from "../db";
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
  turn_id: string | null;
  follow_up_days: number | null;
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
  turnId: r.turn_id,
  followUpDays: r.follow_up_days,
});

export async function insertProposals(runId: string, caseId: string, drafts: ProposalDraft[], turnId: string | null = null): Promise<Proposal[]> {
  const ids = drafts.map(() => randomUUID());
  await transaction(async () => {
    const db = await getDb();
    for (const [i, d] of drafts.entries()) {
      await db.run(
        `INSERT INTO proposals (id, run_id, case_id, kind, title, rationale, amount_pence, document_title, document_body, status, turn_id, follow_up_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [ids[i], runId, caseId, d.kind, d.title, d.rationale, d.amountPence, d.documentTitle, d.documentBody, turnId, d.followUpDays ?? null],
      );
    }
  });
  return Promise.all(ids.map(async (id) => (await getProposal(id))!));
}

export async function getProposal(id: string): Promise<Proposal | null> {
  const row = await (await getDb()).one<ProposalRow>("SELECT * FROM proposals WHERE id = ?", [id]);
  return row ? toProposal(row) : null;
}

export async function listProposals(runId: string): Promise<Proposal[]> {
  return (await (await getDb()).all<ProposalRow>("SELECT * FROM proposals WHERE run_id = ? ORDER BY ord", [runId])).map(toProposal);
}

export async function countPendingProposals(): Promise<number> {
  return (await (await getDb()).one<{ n: number }>("SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'"))!.n;
}

/** Records a decision on a still-pending proposal. Resolves false if someone else decided first. */
export async function recordDecision(id: string, status: "approved" | "rejected", by: string, note: string | null, at: string): Promise<boolean> {
  return (await (await getDb()).run("UPDATE proposals SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ? AND status = 'pending'", [status, by, note, at, id])) === 1;
}

export async function recordExecution(id: string, result: string, at: string): Promise<void> {
  await (await getDb()).run("UPDATE proposals SET status = 'executed', executed_at = ?, execution_result = ? WHERE id = ? AND status = 'approved'", [at, result, id]);
}
