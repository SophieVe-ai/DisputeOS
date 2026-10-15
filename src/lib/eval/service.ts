// Runs the agent eval inside the server, isolated from live data: every scenario gets its own
// throwaway database and in-memory chain (see harness.ts). Results are stored in Postgres, so
// any server instance can report them, and every score is anchored to the audit ledger / chain.
import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "../db";
import { appendEntry } from "../ledger/ledger";
import { runEval, type EvalReport } from "./harness";

const HISTORY_LIMIT = 20;
/** An eval still "running" after this long died with its server instance. */
const STALE_RUN_MS = 10 * 60_000;

export interface EvalRecord {
  report: EvalReport;
  ledgerSeq: number;
}

export interface EvalState {
  running: boolean;
  error: string | null;
  latest: EvalRecord | null;
  history: { startedAt: string; score: number; optimisation: number; efficiency: number; engine: string; ledgerSeq: number }[];
}

interface EvalRow {
  id: string;
  status: "running" | "done" | "failed";
  report_json: string | null;
  ledger_seq: number | null;
  error: string | null;
  started_at: string;
}

const g = globalThis as unknown as { __disputeosEval?: Promise<EvalRecord> | null };

export async function getEvalState(): Promise<EvalState> {
  const db = await getDb();
  const done = (await db.all<EvalRow>("SELECT * FROM eval_runs WHERE status = 'done' ORDER BY ord DESC LIMIT ?", [HISTORY_LIMIT])).reverse();
  const last = await db.one<EvalRow>("SELECT * FROM eval_runs ORDER BY ord DESC LIMIT 1");
  const records = done.map((r): EvalRecord => ({ report: JSON.parse(r.report_json!) as EvalReport, ledgerSeq: r.ledger_seq! }));
  const fresh = (r: EvalRow) => Date.now() - Date.parse(r.started_at) < STALE_RUN_MS;
  return {
    running: last?.status === "running" && fresh(last),
    error: last?.status === "failed" ? last.error : null,
    latest: records.at(-1) ?? null,
    history: records.map((r) => ({
      startedAt: r.report.startedAt,
      score: r.report.score,
      optimisation: r.report.optimisation,
      efficiency: r.report.efficiency,
      engine: r.report.engine,
      ledgerSeq: r.ledgerSeq,
    })),
  };
}

async function execute(requestedBy: string): Promise<EvalRecord> {
  const id = randomUUID();
  const db = await getDb();
  await db.run("INSERT INTO eval_runs (id, status, requested_by, started_at) VALUES (?, 'running', ?, ?)", [id, requestedBy, nowIso()]);
  try {
    const report = await runEval();
    const entry = await appendEntry({
      caseId: null,
      runId: null,
      actor: "system:evaluator",
      action: "eval.completed",
      payload: {
        requestedBy,
        score: report.score,
        optimisation: report.optimisation,
        efficiency: report.efficiency,
        engine: report.engine,
        checks: `${report.checksPassed}/${report.checksTotal}`,
        scenarios: report.scenarios.map((x) => ({ id: x.id, score: x.score })),
      },
    });
    await db.run("UPDATE eval_runs SET status = 'done', report_json = ?, ledger_seq = ?, finished_at = ? WHERE id = ?", [JSON.stringify(report), entry.seq, nowIso(), id]);
    return { report, ledgerSeq: entry.seq };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.run("UPDATE eval_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", [message.slice(0, 500), nowIso(), id]);
    console.error("[eval] run failed", err);
    throw err;
  }
}

/** Starts an eval unless one is already running in this instance. Resolves when the result is recorded. */
export function startEval(requestedBy: string): Promise<EvalRecord> {
  g.__disputeosEval ??= execute(requestedBy).finally(() => {
    g.__disputeosEval = null;
  });
  return g.__disputeosEval;
}
