import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "../db";
import { sha256Hex } from "../ledger/hash";
import type { CorrespondenceMessage, MessageDirection } from "../types";

interface MessageRow {
  id: string;
  case_id: string;
  run_id: string;
  direction: MessageDirection;
  sender: string;
  subject: string;
  body: string;
  proposal_id: string | null;
  sha256: string;
  created_at: string;
}

const toMessage = (r: MessageRow): CorrespondenceMessage => ({
  id: r.id,
  caseId: r.case_id,
  runId: r.run_id,
  direction: r.direction,
  sender: r.sender,
  subject: r.subject,
  body: r.body,
  proposalId: r.proposal_id,
  sha256: r.sha256,
  createdAt: r.created_at,
});

export interface NewMessage {
  caseId: string;
  runId: string;
  direction: MessageDirection;
  sender: string;
  subject: string;
  body: string;
  proposalId?: string | null;
}

export function insertMessage(input: NewMessage): CorrespondenceMessage {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO correspondence (id, case_id, run_id, direction, sender, subject, body, proposal_id, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.caseId, input.runId, input.direction, input.sender, input.subject, input.body, input.proposalId ?? null, sha256Hex(input.body), nowIso());
  return getMessage(id)!;
}

export function getMessage(id: string): CorrespondenceMessage | null {
  const row = getDb().prepare("SELECT * FROM correspondence WHERE id = ?").get(id) as MessageRow | undefined;
  return row ? toMessage(row) : null;
}

export function listMessages(runId: string): CorrespondenceMessage[] {
  return (getDb().prepare("SELECT * FROM correspondence WHERE run_id = ? ORDER BY created_at, rowid").all(runId) as MessageRow[]).map(toMessage);
}

export function countOutbound(runId: string): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM correspondence WHERE run_id = ? AND direction = 'outbound'").get(runId) as { n: number }).n;
}
