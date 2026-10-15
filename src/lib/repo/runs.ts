import { randomUUID } from "node:crypto";
import { getDb, nowIso, transaction } from "../db";
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

export const ACTIVE_RUN_STATUSES: RunStatus[] = ["queued", "running", "awaiting_approval", "awaiting_response"];

export async function insertRun(caseId: string): Promise<Run> {
  const id = randomUUID();
  const now = nowIso();
  await transaction(async () => {
    const db = await getDb();
    await db.run("INSERT INTO runs (id, case_id, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)", [id, caseId, now, now]);
    for (const [i, agent] of AGENT_NAMES.entries()) {
      await db.run("INSERT INTO run_steps (run_id, step_index, agent, status) VALUES (?, ?, ?, 'pending')", [id, i, agent]);
    }
  });
  return (await getRun(id))!;
}

export async function getRun(id: string): Promise<Run | null> {
  const row = await (await getDb()).one<RunRow>("SELECT * FROM runs WHERE id = ?", [id]);
  return row ? toRun(row) : null;
}

export async function latestRunForCase(caseId: string): Promise<Run | null> {
  const row = await (await getDb()).one<RunRow>("SELECT * FROM runs WHERE case_id = ? ORDER BY created_at DESC, ord DESC LIMIT 1", [caseId]);
  return row ? toRun(row) : null;
}

export async function activeRunForCase(caseId: string): Promise<Run | null> {
  const row = await (await getDb()).one<RunRow>(
    `SELECT * FROM runs WHERE case_id = ? AND status IN (${ACTIVE_RUN_STATUSES.map(() => "?").join(",")}) LIMIT 1`,
    [caseId, ...ACTIVE_RUN_STATUSES],
  );
  return row ? toRun(row) : null;
}

/** Locks a run's row until the enclosing transaction ends, serialising state changes across instances. */
export async function lockRun(id: string): Promise<void> {
  await (await getDb()).one("SELECT id FROM runs WHERE id = ? FOR UPDATE", [id]);
}

export async function getSteps(runId: string): Promise<RunStep[]> {
  return (await (await getDb()).all<StepRow>("SELECT * FROM run_steps WHERE run_id = ? ORDER BY step_index", [runId])).map(toStep);
}

/**
 * Atomically leases the next runnable run (queued, or running with an expired lease — i.e. crash recovery).
 * SKIP LOCKED makes this safe across server instances: two claimers never get the same run.
 */
export async function claimNextRun(leaseMs: number, excludeIds: string[] = []): Promise<Run | null> {
  const now = nowIso();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
  const exclude = excludeIds.length ? `AND id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
  const row = await (await getDb()).one<RunRow>(
    `UPDATE runs SET status = 'running', lease_until = ?, updated_at = ?
     WHERE id = (SELECT id FROM runs WHERE status IN ('queued', 'running') AND (lease_until IS NULL OR lease_until < ?) ${exclude}
                 ORDER BY created_at, ord LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [leaseUntil, now, now, ...excludeIds],
  );
  return row ? toRun(row) : null;
}

export async function updateRun(id: string, patch: Partial<Pick<Run, "status" | "stepIndex" | "attempts" | "leaseUntil" | "error" | "completedAt">>): Promise<void> {
  const current = await getRun(id);
  if (!current) throw new Error(`Run ${id} not found`);
  const next = { ...current, ...patch };
  await (await getDb()).run(
    "UPDATE runs SET status = ?, step_index = ?, attempts = ?, lease_until = ?, error = ?, completed_at = ?, updated_at = ? WHERE id = ?",
    [next.status, next.stepIndex, next.attempts, next.leaseUntil, next.error, next.completedAt, nowIso(), id],
  );
}

export async function updateStep(runId: string, stepIndex: number, patch: Partial<Pick<RunStep, "status" | "engine" | "output" | "startedAt" | "finishedAt" | "error">>): Promise<void> {
  const current = (await getSteps(runId)).find((s) => s.stepIndex === stepIndex);
  if (!current) throw new Error(`Step ${stepIndex} of run ${runId} not found`);
  const next = { ...current, ...patch };
  await (await getDb()).run(
    "UPDATE run_steps SET status = ?, engine = ?, output_json = ?, started_at = ?, finished_at = ?, error = ? WHERE run_id = ? AND step_index = ?",
    [next.status, next.engine, next.output === null ? null : JSON.stringify(next.output), next.startedAt, next.finishedAt, next.error, runId, stepIndex],
  );
}
