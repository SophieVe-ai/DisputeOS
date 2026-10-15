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

export async function insertMessage(input: NewMessage): Promise<CorrespondenceMessage> {
  const id = randomUUID();
  await (await getDb()).run(
    `INSERT INTO correspondence (id, case_id, run_id, direction, sender, subject, body, proposal_id, sha256, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.caseId, input.runId, input.direction, input.sender, input.subject, input.body, input.proposalId ?? null, sha256Hex(input.body), nowIso()],
  );
  return (await getMessage(id))!;
}

export async function getMessage(id: string): Promise<CorrespondenceMessage | null> {
  const row = await (await getDb()).one<MessageRow>("SELECT * FROM correspondence WHERE id = ?", [id]);
  return row ? toMessage(row) : null;
}

export async function listMessages(runId: string): Promise<CorrespondenceMessage[]> {
  return (await (await getDb()).all<MessageRow>("SELECT * FROM correspondence WHERE run_id = ? ORDER BY created_at, ord", [runId])).map(toMessage);
}

export async function countOutbound(runId: string): Promise<number> {
  return (await (await getDb()).one<{ n: number }>("SELECT COUNT(*) AS n FROM correspondence WHERE run_id = ? AND direction = 'outbound'", [runId]))!.n;
}
