import { randomUUID } from "node:crypto";
import { getDb, nowIso, transaction } from "../db";
import type { CaseDocument, CaseStatus, DisputeCase, DocKind } from "../types";

interface CaseRow {
  id: string;
  reference: string;
  title: string;
  creditor: string;
  debtor: string;
  debtor_email: string | null;
  claimed_amount_pence: number;
  status: CaseStatus;
  summary: string;
  created_at: string;
}

interface DocRow {
  id: string;
  case_id: string;
  kind: DocKind;
  title: string;
  content: string;
  doc_date: string | null;
}

const toCase = (r: CaseRow): DisputeCase => ({
  id: r.id,
  reference: r.reference,
  title: r.title,
  creditor: r.creditor,
  debtor: r.debtor,
  debtorEmail: r.debtor_email,
  claimedAmountPence: r.claimed_amount_pence,
  status: r.status,
  summary: r.summary,
  createdAt: r.created_at,
});

const toDoc = (r: DocRow): CaseDocument => ({
  id: r.id,
  caseId: r.case_id,
  kind: r.kind,
  title: r.title,
  content: r.content,
  docDate: r.doc_date,
});

export interface NewCaseInput {
  reference?: string;
  title: string;
  creditor: string;
  debtor: string;
  debtorEmail: string | null;
  claimedAmountPence: number;
  summary: string;
  documents: { kind: DocKind; title: string; content: string; docDate: string | null }[];
}

export async function createCase(input: NewCaseInput, id: string = randomUUID()): Promise<DisputeCase> {
  const reference = input.reference ?? `DOS-${Date.now().toString(36).toUpperCase()}`;
  await transaction(async () => {
    const db = await getDb();
    await db.run(
      `INSERT INTO cases (id, reference, title, creditor, debtor, debtor_email, claimed_amount_pence, status, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [id, reference, input.title, input.creditor, input.debtor, input.debtorEmail, input.claimedAmountPence, input.summary, nowIso()],
    );
    for (const [i, d] of input.documents.entries()) {
      await db.run("INSERT INTO documents (id, case_id, kind, title, content, doc_date) VALUES (?, ?, ?, ?, ?, ?)", [`${id.slice(0, 8)}-D${i + 1}`, id, d.kind, d.title, d.content, d.docDate]);
    }
  });
  return (await getCase(id))!;
}

export async function getCase(id: string): Promise<DisputeCase | null> {
  const row = await (await getDb()).one<CaseRow>("SELECT * FROM cases WHERE id = ?", [id]);
  return row ? toCase(row) : null;
}

export async function listCases(): Promise<DisputeCase[]> {
  return (await (await getDb()).all<CaseRow>("SELECT * FROM cases ORDER BY created_at DESC, ord DESC")).map(toCase);
}

export async function countCases(): Promise<number> {
  return (await (await getDb()).one<{ n: number }>("SELECT COUNT(*) AS n FROM cases"))!.n;
}

export async function getDocuments(caseId: string): Promise<CaseDocument[]> {
  return (await (await getDb()).all<DocRow>("SELECT * FROM documents WHERE case_id = ? ORDER BY ord", [caseId])).map(toDoc);
}

export async function setCaseStatus(caseId: string, status: CaseStatus): Promise<void> {
  await (await getDb()).run("UPDATE cases SET status = ? WHERE id = ?", [status, caseId]);
}
