// Read model for the live chain console: every ledger entry for a scope, joined with
// the `EntryAnchored` log the contract actually emitted for it (read back from the chain).
import type { ChainEvent } from "./anchor";
import { anchorError, getAnchor } from "./anchor-registry";
import { listEntries, type AnchorStatus } from "./ledger";

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 300;

export interface FeedEntry {
  seq: number;
  caseId: string | null;
  actor: string;
  action: string;
  createdAt: string;
  entryHash: string;
  prevHash: string;
  anchorStatus: AnchorStatus;
  anchorError: string | null;
  /** The on-chain log for this entry, if it has been mined. */
  event: ChainEvent | null;
  /** Whether the database hash equals the hash anchored on-chain (null until mined). */
  hashMatches: boolean | null;
}

export interface ChainFeed {
  chain:
    | { connected: true; network: string; chainId: string; contractAddress: string; writer: string; latestBlock: number; error: string | null }
    | { connected: false; error: string | null };
  entries: FeedEntry[];
}

export async function chainFeed(opts: { caseId?: string; limit?: number } = {}): Promise<ChainFeed> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = listEntries({ caseId: opts.caseId, limit }).reverse();
  const anchor = await getAnchor();

  let events: ChainEvent[] = [];
  let chain: ChainFeed["chain"] = { connected: false, error: anchorError() };
  if (anchor) {
    const info = anchor.info();
    try {
      const [latestBlock, logs] = await Promise.all([anchor.latestBlock(), anchor.events({ caseId: opts.caseId, limit })]);
      events = logs;
      chain = { connected: true, ...info, latestBlock, error: null };
    } catch (err) {
      chain = { connected: true, ...info, latestBlock: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // The contract anchors in ledger order, so on-chain index = seq - 1.
  const byIndex = new Map(events.map((e) => [e.index, e]));
  const entries = rows.map((row): FeedEntry => {
    const event = byIndex.get(row.seq - 1) ?? null;
    return {
      seq: row.seq,
      caseId: row.caseId,
      actor: row.actor,
      action: row.action,
      createdAt: row.createdAt,
      entryHash: row.entryHash,
      prevHash: row.prevHash,
      anchorStatus: row.anchor.status,
      anchorError: row.anchor.error,
      event,
      hashMatches: event ? event.entryHash.toLowerCase() === row.entryHash.toLowerCase() : null,
    };
  });
  return { chain, entries };
}
