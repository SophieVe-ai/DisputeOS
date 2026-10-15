import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "../db";
import { AGENT_NAMES, type AgentName, type Engine, type Run, type RunStatus, type RunStep, type StepStatus } from "../types";

interface RunRow {
  id: string;
  case_id: string;
  status: RunStatus;
  step_index: number;
  attempts: number;
  lease_until: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface StepRow {
  run_id: string;
  step_index: number;
  agent: AgentName;
  status: StepStatus;
  engine: Engine | null;
  output_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

const toRun = (r: RunRow): Run => ({
  id: r.id,
  caseId: r.case_id,
  status: r.status,
  stepIndex: r.step_index,
  attempts: r.attempts,
  leaseUntil: r.lease_until,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  completedAt: r.completed_at,
});

const toStep = (r: StepRow): RunStep => ({
  runId: r.run_id,
  stepIndex: r.step_index,
  agent: r.agent,
  status: r.status,
  engine: r.engine,
  output: r.output_json ? JSON.parse(r.output_json) : null,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  error: r.error,
});

export const ACTIVE_RUN_STATUSES: RunStatus[] = ["queued", "running", "awaiting_approval"];

export function insertRun(caseId: string): Run {
  const db = getDb();
  const id = randomUUID();
  const now = nowIso();
  db.transaction(() => {
    db.prepare("INSERT INTO runs (id, case_id, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)").run(id, caseId, now, now);
    const step = db.prepare("INSERT INTO run_steps (run_id, step_index, agent, status) VALUES (?, ?, ?, 'pending')");
    AGENT_NAMES.forEach((agent, i) => step.run(id, i, agent));
  })();
  return getRun(id)!;
}

export function getRun(id: string): Run | null {
  const row = getDb().prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function latestRunForCase(caseId: string): Run | null {
  const row = getDb().prepare("SELECT * FROM runs WHERE case_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(caseId) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function activeRunForCase(caseId: string): Run | null {
  const row = getDb()
    .prepare(`SELECT * FROM runs WHERE case_id = ? AND status IN (${ACTIVE_RUN_STATUSES.map(() => "?").join(",")}) LIMIT 1`)
    .get(caseId, ...ACTIVE_RUN_STATUSES) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function getSteps(runId: string): RunStep[] {
  return (getDb().prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY step_index").all(runId) as StepRow[]).map(toStep);
}

/** Atomically leases the next runnable run (queued, or running with an expired lease — i.e. crash recovery). */
export function claimNextRun(leaseMs: number, excludeIds: string[] = []): Run | null {
  const now = nowIso();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
  const exclude = excludeIds.length ? `AND id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
  const row = getDb()
    .prepare(
      `UPDATE runs SET status = 'running', lease_until = ?, updated_at = ?
       WHERE id = (SELECT id FROM runs WHERE status IN ('queued', 'running') AND (lease_until IS NULL OR lease_until < ?) ${exclude}
                   ORDER BY created_at LIMIT 1)
       RETURNING *`,
    )
    .get(leaseUntil, now, now, ...excludeIds) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function updateRun(id: string, patch: Partial<Pick<Run, "status" | "stepIndex" | "attempts" | "leaseUntil" | "error" | "completedAt">>): void {
  const current = getRun(id);
  if (!current) throw new Error(`Run ${id} not found`);
  const next = { ...current, ...patch };
  getDb()
    .prepare("UPDATE runs SET status = ?, step_index = ?, attempts = ?, lease_until = ?, error = ?, completed_at = ?, updated_at = ? WHERE id = ?")
    .run(next.status, next.stepIndex, next.attempts, next.leaseUntil, next.error, next.completedAt, nowIso(), id);
}

export function updateStep(runId: string, stepIndex: number, patch: Partial<Pick<RunStep, "status" | "engine" | "output" | "startedAt" | "finishedAt" | "error">>): void {
  const current = getSteps(runId).find((s) => s.stepIndex === stepIndex);
  if (!current) throw new Error(`Step ${stepIndex} of run ${runId} not found`);
  const next = { ...current, ...patch };
  getDb()
    .prepare("UPDATE run_steps SET status = ?, engine = ?, output_json = ?, started_at = ?, finished_at = ?, error = ? WHERE run_id = ? AND step_index = ?")
    .run(next.status, next.engine, next.output === null ? null : JSON.stringify(next.output), next.startedAt, next.finishedAt, next.error, runId, stepIndex);
}
