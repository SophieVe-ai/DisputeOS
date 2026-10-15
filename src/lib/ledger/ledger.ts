// Append-only, hash-chained audit ledger. Every agent action and human decision is
// written here and anchored on-chain. Agents receive only an `append` closure (see
// orchestrator/context.ts) — they cannot read keys, rewrite rows or touch the chain.
import { config } from "../config";
import { detached, getDb, inSandbox, nowIso, transaction } from "../db";
import { anchorError, getAnchor, resetAnchor } from "./anchor-registry";
import { describeEntry } from "./describe";
import { canonicalJson, computeEntryHash, GENESIS_HASH, sha256Hex } from "./hash";

export interface AppendInput {
  caseId: string | null;
  runId: string | null;
  actor: string;
  action: string;
  payload: unknown;
}

export type AnchorStatus = "pending" | "anchored" | "error";

export interface LedgerEntry {
  seq: number;
  caseId: string | null;
  runId: string | null;
  actor: string;
  action: string;
  /** Plain-English summary of what this entry records. */
  description: string;
  payload: unknown;
  payloadHash: string;
  prevHash: string;
  entryHash: string;
  createdAt: string;
  anchor: {
    status: AnchorStatus;
    txHash: string | null;
    blockNumber: number | null;
    chainId: string | null;
    contractAddress: string | null;
    error: string | null;
  };
}

interface EntryRow {
  seq: number;
  case_id: string | null;
  run_id: string | null;
  actor: string;
  action: string;
  payload_json: string;
  payload_hash: string;
  prev_hash: string;
  entry_hash: string;
  created_at: string;
  status: AnchorStatus | null;
  tx_hash: string | null;
  block_number: number | null;
  chain_id: string | null;
  contract_address: string | null;
  error: string | null;
}

const SELECT_ENTRIES = `
  SELECT e.*, a.status, a.tx_hash, a.block_number, a.chain_id, a.contract_address, a.error
  FROM ledger_entries e LEFT JOIN ledger_anchors a ON a.seq = e.seq`;

function toEntry(row: EntryRow): LedgerEntry {
  const payload = JSON.parse(row.payload_json) as unknown;
  return {
    seq: row.seq,
    caseId: row.case_id,
    runId: row.run_id,
    actor: row.actor,
    action: row.action,
    description: describeEntry({ actor: row.actor, action: row.action, payload }),
    payload,
    payloadHash: row.payload_hash,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    createdAt: row.created_at,
    anchor: {
      status: row.status ?? "pending",
      txHash: row.tx_hash,
      blockNumber: row.block_number,
      chainId: row.chain_id,
      contractAddress: row.contract_address,
      error: row.error,
    },
  };
}

/** Advisory-lock keys: one writer extends the hash chain at a time, one instance anchors at a time. */
const LEDGER_LOCK = 4_242;
const ANCHOR_LOCK = 4_243;

export async function appendEntry(input: AppendInput): Promise<LedgerEntry> {
  const seq = await transaction(async () => {
    const db = await getDb();
    // Serialises appends across server instances, so two writers can never fork the chain.
    await db.one("SELECT pg_advisory_xact_lock(?)", [LEDGER_LOCK]);
    const last = await db.one<{ seq: number; entry_hash: string }>("SELECT seq, entry_hash FROM ledger_entries ORDER BY seq DESC LIMIT 1");
    const next = (last?.seq ?? 0) + 1;
    const prevHash = last?.entry_hash ?? GENESIS_HASH;
    const payloadJson = canonicalJson(input.payload ?? null);
    const payloadHash = sha256Hex(payloadJson);
    const createdAt = nowIso();
    const entryHash = computeEntryHash({ seq: next, caseId: input.caseId, runId: input.runId, actor: input.actor, action: input.action, payloadHash, prevHash, createdAt });
    await db.run(
      `INSERT INTO ledger_entries (seq, case_id, run_id, actor, action, payload_json, payload_hash, prev_hash, entry_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [next, input.caseId, input.runId, input.actor, input.action, payloadJson, payloadHash, prevHash, entryHash, createdAt],
    );
    await db.run("INSERT INTO ledger_anchors (seq, status) VALUES (?, 'pending')", [next]);
    return next;
  });
  // Locally a long-lived process anchors straight away; on Vercel the request drain does it.
  if (!config.serverless && !inSandbox()) detached(() => void syncAnchors());
  return (await getEntry(seq))!;
}

export async function getEntry(seq: number): Promise<LedgerEntry | null> {
  const row = await (await getDb()).one<EntryRow>(`${SELECT_ENTRIES} WHERE e.seq = ?`, [seq]);
  return row ? toEntry(row) : null;
}

export async function listEntries(opts: { caseId?: string; limit?: number } = {}): Promise<LedgerEntry[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const rows = opts.caseId
    ? await db.all<EntryRow>(`${SELECT_ENTRIES} WHERE e.case_id = ? ORDER BY e.seq DESC LIMIT ?`, [opts.caseId, limit])
    : await db.all<EntryRow>(`${SELECT_ENTRIES} ORDER BY e.seq DESC LIMIT ?`, [limit]);
  return rows.map(toEntry);
}

export async function ledgerStats(): Promise<{ total: number; anchored: number; pending: number; errored: number }> {
  const row = (await (await getDb()).one<{ total: number; anchored: number | null; errored: number | null }>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN a.status = 'anchored' THEN 1 ELSE 0 END)::int AS anchored,
       SUM(CASE WHEN a.status = 'error' THEN 1 ELSE 0 END)::int AS errored
     FROM ledger_entries e LEFT JOIN ledger_anchors a ON a.seq = e.seq`,
  ))!;
  const anchored = row.anchored ?? 0;
  const errored = row.errored ?? 0;
  return { total: row.total, anchored, errored, pending: row.total - anchored - errored };
}

// ---------- Anchoring (serialised, in sequence order) ----------

const g = globalThis as unknown as { __disputeosSync?: Promise<void> | null; __disputeosSyncAgain?: boolean };

/** Anchors all pending entries in order. Concurrent callers coalesce into one loop. */
export function syncAnchors(): Promise<void> {
  if (inSandbox()) return anchorPending(); // a sandbox has its own database and chain: never coalesce with the app's loop
  if (g.__disputeosSync) {
    g.__disputeosSyncAgain = true;
    return g.__disputeosSync;
  }
  g.__disputeosSync = (async () => {
    do {
      g.__disputeosSyncAgain = false;
      await anchorPending();
    } while (g.__disputeosSyncAgain);
  })()
    .catch((err: unknown) => {
      console.error("[ledger] anchoring loop failed", err);
    })
    .finally(() => {
      g.__disputeosSync = null;
    });
  return g.__disputeosSync;
}

/** Anchors pending entries, but only on the one instance that wins the anchoring lock. */
async function anchorPending(): Promise<void> {
  const db = await getDb();
  await db.tryLock(ANCHOR_LOCK, () => anchorPendingLocked());
}

async function anchorPendingLocked(): Promise<void> {
  const anchor = await getAnchor();
  if (!anchor) return;
  anchor.beginSession();
  const db = await getDb();
  const info = anchor.info();
  // A different contract (e.g. local chain restarted) means previous anchors no longer exist there.
  await db.run(
    "UPDATE ledger_anchors SET status = 'pending', tx_hash = NULL, block_number = NULL, error = NULL WHERE contract_address IS NOT NULL AND contract_address != ?",
    [info.contractAddress],
  );
  // A restarted local chain can redeploy at the same address with an empty log:
  // re-queue any entry the chain no longer holds so anchoring self-heals instead of wedging.
  const onChainNow = await anchor.count();
  await db.run("UPDATE ledger_anchors SET status = 'pending', tx_hash = NULL, block_number = NULL, error = NULL WHERE status != 'pending' AND seq > ?", [onChainNow]);

  const pending = await db.all<{ seq: number; case_id: string | null; actor: string; action: string; entry_hash: string; prev_hash: string }>(
    `SELECT e.seq, e.case_id, e.actor, e.action, e.entry_hash, e.prev_hash
     FROM ledger_entries e JOIN ledger_anchors a ON a.seq = e.seq
     WHERE a.status != 'anchored' ORDER BY e.seq`,
  );

  const markAnchored = (txHash: string | null, block: number | null, seq: number) =>
    db.run(
      "UPDATE ledger_anchors SET status = 'anchored', tx_hash = ?, block_number = ?, chain_id = ?, contract_address = ?, anchored_at = ?, error = NULL WHERE seq = ?",
      [txHash, block, info.chainId, info.contractAddress, nowIso(), seq],
    );
  const markError = (error: string, seq: number) => db.run("UPDATE ledger_anchors SET status = 'error', error = ? WHERE seq = ?", [error, seq]);

  for (const row of pending) {
    try {
      const onChain = await anchor.count();
      const index = row.seq - 1;
      if (onChain > index) {
        // Already on chain (e.g. a previous attempt timed out after mining). Confirm it is ours.
        const [hash] = await anchor.hashesInRange(index, index + 1);
        if (hash?.toLowerCase() !== row.entry_hash.toLowerCase()) {
          await markError(`On-chain slot ${index} holds a different hash — ledger diverged`, row.seq);
          return;
        }
        await markAnchored(null, null, row.seq);
        continue;
      }
      if (onChain < index) {
        await markError(`Chain has ${onChain} entries; cannot anchor seq ${row.seq} out of order`, row.seq);
        return;
      }
      const receipt = await anchor.append({
        entryHash: row.entry_hash,
        prevHash: row.prev_hash,
        caseId: row.case_id,
        actor: row.actor,
        action: row.action,
      });
      await markAnchored(receipt.txHash, receipt.blockNumber, row.seq);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markError(message.slice(0, 500), row.seq);
      resetAnchor(message);
      return;
    }
  }
}

// ---------- Verification ----------

export type OnChainCheck = "match" | "mismatch" | "missing" | "unavailable";

export interface EntryVerification {
  seq: number;
  caseId: string | null;
  actor: string;
  action: string;
  createdAt: string;
  payloadIntact: boolean;
  hashIntact: boolean;
  linkIntact: boolean;
  onChain: OnChainCheck;
  problems: string[];
}

export interface VerificationReport {
  ok: boolean;
  checked: number;
  failures: number;
  /** On-chain anchors with no corresponding database row (log truncated or wiped). */
  missingFromDb: number;
  chain: {
    available: boolean;
    chainId: string | null;
    contractAddress: string | null;
    network: string | null;
    onChainCount: number | null;
    error: string | null;
  };
  entries: EntryVerification[];
  verifiedAt: string;
}

export async function verifyLedger(caseId?: string): Promise<VerificationReport> {
  const rows = await (await getDb()).all<EntryRow>(`${SELECT_ENTRIES} ORDER BY e.seq ASC`);
  const anchor = await getAnchor();
  let onChainHashes: string[] | null = null;
  let chainError: string | null = anchor ? null : anchorError();
  if (anchor) {
    try {
      const count = await anchor.count();
      onChainHashes = await anchor.hashesInRange(0, count);
    } catch (err) {
      chainError = err instanceof Error ? err.message : String(err);
      resetAnchor(chainError);
    }
  }

  let prevRecomputed = GENESIS_HASH;
  const results: EntryVerification[] = [];
  for (const row of rows) {
    const problems: string[] = [];
    const payloadIntact = sha256Hex(row.payload_json) === row.payload_hash;
    if (!payloadIntact) problems.push("Payload does not match its recorded hash");
    const recomputed = computeEntryHash({
      seq: row.seq,
      caseId: row.case_id,
      runId: row.run_id,
      actor: row.actor,
      action: row.action,
      payloadHash: sha256Hex(row.payload_json),
      prevHash: row.prev_hash,
      createdAt: row.created_at,
    });
    const hashIntact = recomputed === row.entry_hash;
    if (!hashIntact) problems.push("Entry contents do not match the recorded entry hash");
    const linkIntact = row.prev_hash === prevRecomputed;
    if (!linkIntact) problems.push("Hash-chain link to the previous entry is broken");

    let onChain: OnChainCheck = "unavailable";
    if (onChainHashes) {
      const anchoredHash = onChainHashes[row.seq - 1];
      if (!anchoredHash) {
        onChain = "missing";
        if (row.status === "anchored") problems.push("Entry marked anchored but not found on-chain");
      } else if (anchoredHash.toLowerCase() === recomputed.toLowerCase()) {
        onChain = "match";
      } else {
        onChain = "mismatch";
        problems.push("Recomputed hash differs from the immutable on-chain anchor");
      }
    }
    prevRecomputed = recomputed;
    if (!caseId || row.case_id === caseId) {
      results.push({
        seq: row.seq,
        caseId: row.case_id,
        actor: row.actor,
        action: row.action,
        createdAt: row.created_at,
        payloadIntact,
        hashIntact,
        linkIntact,
        onChain,
        problems,
      });
    }
  }

  // Entries anchored on-chain but missing from the database = truncated / wiped log.
  const missingFromDb = onChainHashes ? Math.max(0, onChainHashes.length - rows.length) : 0;
  const failures = results.filter((r) => r.problems.length > 0).length + missingFromDb;
  const info = anchor?.info() ?? null;
  return {
    ok: failures === 0,
    checked: results.length,
    failures,
    missingFromDb,
    chain: {
      available: onChainHashes !== null,
      chainId: info?.chainId ?? null,
      contractAddress: info?.contractAddress ?? null,
      network: info?.network ?? null,
      onChainCount: onChainHashes?.length ?? null,
      error: chainError,
    },
    entries: results,
    verifiedAt: nowIso(),
  };
}
