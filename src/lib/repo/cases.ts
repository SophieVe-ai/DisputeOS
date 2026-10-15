import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "../db";
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

export function createCase(input: NewCaseInput, id: string = randomUUID()): DisputeCase {
  const db = getDb();
  const reference = input.reference ?? `DOS-${Date.now().toString(36).toUpperCase()}`;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO cases (id, reference, title, creditor, debtor, debtor_email, claimed_amount_pence, status, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).run(id, reference, input.title, input.creditor, input.debtor, input.debtorEmail, input.claimedAmountPence, input.summary, nowIso());
    const insertDoc = db.prepare(
      "INSERT INTO documents (id, case_id, kind, title, content, doc_date) VALUES (?, ?, ?, ?, ?, ?)",
    );
    input.documents.forEach((d, i) => insertDoc.run(`${id.slice(0, 8)}-D${i + 1}`, id, d.kind, d.title, d.content, d.docDate));
  })();
  return getCase(id)!;
}

export function getCase(id: string): DisputeCase | null {
  const row = getDb().prepare("SELECT * FROM cases WHERE id = ?").get(id) as CaseRow | undefined;
  return row ? toCase(row) : null;
}

export function listCases(): DisputeCase[] {
  return (getDb().prepare("SELECT * FROM cases ORDER BY created_at DESC").all() as CaseRow[]).map(toCase);
}

export function countCases(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM cases").get() as { n: number }).n;
}

export function getDocuments(caseId: string): CaseDocument[] {
  return (getDb().prepare("SELECT * FROM documents WHERE case_id = ? ORDER BY rowid").all(caseId) as DocRow[]).map(toDoc);
}

export function setCaseStatus(caseId: string, status: CaseStatus): void {
  getDb().prepare("UPDATE cases SET status = ? WHERE id = ?").run(status, caseId);
}
