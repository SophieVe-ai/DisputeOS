// Durable wake-ups for the Negotiation agent. A wake-up is leased like a run, so a crash
// mid-turn is retried, and only one turn per run is ever in flight.
import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "../db";
import type { Engine, NegotiationOutput, Wakeup, WakeupKind, WakeupStatus } from "../types";

interface WakeupRow {
  id: string;
  run_id: string;
  case_id: string;
  kind: WakeupKind;
  message_id: string | null;
  reason: string;
  due_at: string;
  status: WakeupStatus;
  attempts: number;
  lease_until: string | null;
  engine: Engine | null;
  output_json: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const toWakeup = (r: WakeupRow): Wakeup => ({
  id: r.id,
  runId: r.run_id,
  caseId: r.case_id,
  kind: r.kind,
  messageId: r.message_id,
  reason: r.reason,
  dueAt: r.due_at,
  status: r.status,
  attempts: r.attempts,
  leaseUntil: r.lease_until,
  engine: r.engine,
  output: r.output_json ? (JSON.parse(r.output_json) as NegotiationOutput) : null,
  error: r.error,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});

export interface NewWakeup {
  runId: string;
  caseId: string;
  kind: WakeupKind;
  reason: string;
  dueAt: string;
  messageId?: string | null;
}

export function insertWakeup(input: NewWakeup): Wakeup {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO run_wakeups (id, run_id, case_id, kind, message_id, reason, due_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
    )
    .run(id, input.runId, input.caseId, input.kind, input.messageId ?? null, input.reason, input.dueAt, nowIso());
  return getWakeup(id)!;
}

export function getWakeup(id: string): Wakeup | null {
  const row = getDb().prepare("SELECT * FROM run_wakeups WHERE id = ?").get(id) as WakeupRow | undefined;
  return row ? toWakeup(row) : null;
}

export function listWakeups(runId: string): Wakeup[] {
  return (getDb().prepare("SELECT * FROM run_wakeups WHERE run_id = ? ORDER BY created_at, rowid").all(runId) as WakeupRow[]).map(toWakeup);
}

/** The next scheduled wake-up for a run (soonest first). */
export function nextScheduledWakeup(runId: string, kind?: WakeupKind): Wakeup | null {
  const row = getDb()
    .prepare(`SELECT * FROM run_wakeups WHERE run_id = ? AND status = 'scheduled' ${kind ? "AND kind = ?" : ""} ORDER BY due_at LIMIT 1`)
    .get(...(kind ? [runId, kind] : [runId])) as WakeupRow | undefined;
  return row ? toWakeup(row) : null;
}

/** Cancels every scheduled or in-flight wake-up for a run (the run is ending). Returns the cancelled rows. */
export function cancelOpen(runId: string): Wakeup[] {
  const rows = getDb()
    .prepare("UPDATE run_wakeups SET status = 'cancelled', lease_until = NULL, finished_at = ? WHERE run_id = ? AND status IN ('scheduled', 'processing') RETURNING *")
    .all(nowIso(), runId) as WakeupRow[];
  return rows.map(toWakeup);
}

export function cancelWakeup(id: string): void {
  getDb().prepare("UPDATE run_wakeups SET status = 'cancelled', lease_until = NULL, finished_at = ? WHERE id = ? AND status IN ('scheduled', 'processing')").run(nowIso(), id);
}

/** Cancels scheduled wake-ups of one kind (or all kinds) for a run. Returns how many were cancelled. */
export function cancelScheduled(runId: string, kind?: WakeupKind): number {
  return getDb()
    .prepare(`UPDATE run_wakeups SET status = 'cancelled', finished_at = ? WHERE run_id = ? AND status = 'scheduled' ${kind ? "AND kind = ?" : ""}`)
    .run(...(kind ? [nowIso(), runId, kind] : [nowIso(), runId])).changes;
}

/**
 * Atomically leases the next due wake-up. Only runs that are waiting on the debtor are eligible,
 * and a run with a turn already in flight is skipped, so turns for one case never overlap.
 * Expired leases are recovered first (and count as a failed attempt); replies go before
 * deadlines, so a lapsed timer never acts without reading a reply that is already in.
 */
export function claimDueWakeup(leaseMs: number, excludeIds: string[] = []): Wakeup | null {
  const now = nowIso();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
  const exclude = excludeIds.length ? `AND w.id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
  const row = getDb()
    .prepare(
      `UPDATE run_wakeups SET status = 'processing', lease_until = ?, attempts = attempts + (status = 'processing')
       WHERE id = (
         SELECT w.id FROM run_wakeups w JOIN runs r ON r.id = w.run_id
         WHERE r.status = 'awaiting_response'
           AND ((w.status = 'scheduled' AND w.due_at <= ?) OR (w.status = 'processing' AND w.lease_until < ?))
           AND NOT EXISTS (
             SELECT 1 FROM run_wakeups o
             WHERE o.run_id = w.run_id AND o.id != w.id AND o.status = 'processing' AND o.lease_until >= ?
           )
           ${exclude}
         ORDER BY (w.status = 'processing') DESC, (w.kind = 'reply') DESC, w.due_at, w.rowid LIMIT 1)
       RETURNING *`,
    )
    .get(leaseUntil, now, now, now, ...excludeIds) as WakeupRow | undefined;
  return row ? toWakeup(row) : null;
}

export function completeWakeup(id: string, engine: Engine, output: NegotiationOutput): void {
  getDb()
    .prepare("UPDATE run_wakeups SET status = 'done', engine = ?, output_json = ?, error = NULL, lease_until = NULL, finished_at = ? WHERE id = ?")
    .run(engine, JSON.stringify(output), nowIso(), id);
}

/** Records a failed attempt: reschedules it at `retryAt`, or marks it failed when `retryAt` is null. */
export function failWakeup(id: string, attempts: number, error: string, retryAt: string | null): void {
  getDb()
    .prepare("UPDATE run_wakeups SET status = ?, attempts = ?, error = ?, due_at = COALESCE(?, due_at), lease_until = NULL, finished_at = ? WHERE id = ?")
    .run(retryAt ? "scheduled" : "failed", attempts, error, retryAt, retryAt ? null : nowIso(), id);
}

export function setWakeupDue(id: string, dueAt: string): void {
  getDb().prepare("UPDATE run_wakeups SET due_at = ? WHERE id = ? AND status = 'scheduled'").run(dueAt, id);
}
