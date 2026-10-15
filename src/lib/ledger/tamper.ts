// DEMO ONLY: simulates an insider / compromised agent with raw database access
// rewriting a logged agent decision. It bypasses the append-only triggers and even
// recomputes the row's own hashes — the on-chain anchor still exposes the change.
import { getDb, transaction } from "../db";
import { canonicalJson, computeEntryHash, sha256Hex } from "./hash";

export interface TamperResult {
  seq: number;
  action: string;
  before: unknown;
  after: unknown;
}

export async function tamperWithCase(caseId: string): Promise<TamperResult | null> {
  const db = await getDb();
  const target = await db.one<{ seq: number; case_id: string | null; run_id: string | null; actor: string; action: string; payload_json: string; prev_hash: string; created_at: string }>(
    `SELECT * FROM ledger_entries WHERE case_id = ? AND action IN ('challenge.completed', 'reconciliation.completed', 'evidence.completed')
     ORDER BY CASE action WHEN 'challenge.completed' THEN 0 WHEN 'reconciliation.completed' THEN 1 ELSE 2 END, seq DESC LIMIT 1`,
    [caseId],
  );
  if (!target) return null;

  // Completed-step payloads look like { engine, output }. Inflate the agent's conclusion.
  const before = JSON.parse(target.payload_json) as { engine?: string; output?: Record<string, unknown> };
  const output: Record<string, unknown> = { ...(before.output ?? {}) };
  output.summary = "All debtor claims rebutted. Pursue the full amount immediately.";
  for (const key of ["defensiblePrincipalPence", "totalRecoverablePence", "supportedPrincipalPence"]) {
    if (typeof output[key] === "number") output[key] = Math.round((output[key] as number) * 1.5);
  }
  if (Array.isArray(output.challenges)) {
    output.challenges = (output.challenges as Record<string, unknown>[]).map((c) => ({ ...c, verdict: "rebutted", impactPence: 0 }));
  }
  const after = { ...before, output };
  const payloadJson = canonicalJson(after);
  const payloadHash = sha256Hex(payloadJson);
  const entryHash = computeEntryHash({
    seq: target.seq,
    caseId: target.case_id,
    runId: target.run_id,
    actor: target.actor,
    action: target.action,
    payloadHash,
    prevHash: target.prev_hash,
    createdAt: target.created_at,
  });

  // The insider disables the append-only trigger, rewrites the row, and re-enables it.
  await transaction(async () => {
    const t = await getDb();
    await t.exec("ALTER TABLE ledger_entries DISABLE TRIGGER ledger_no_update");
    await t.run("UPDATE ledger_entries SET payload_json = ?, payload_hash = ?, entry_hash = ? WHERE seq = ?", [payloadJson, payloadHash, entryHash, target.seq]);
    await t.exec("ALTER TABLE ledger_entries ENABLE TRIGGER ledger_no_update");
  });
  return { seq: target.seq, action: target.action, before, after };
}
