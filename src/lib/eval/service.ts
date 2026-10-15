// Runs the eval in a child process (so it can never touch the live database), keeps a
// short history on disk, and anchors every result to the audit ledger / chain.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { appendEntry } from "../ledger/ledger";
import type { EvalReport } from "./harness";

const HISTORY_LIMIT = 20;
const EVAL_TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

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

const g = globalThis as unknown as { __disputeosEval?: { running: Promise<EvalRecord> | null; error: string | null } };
const state = () => (g.__disputeosEval ??= { running: null, error: null });

const historyFile = () => path.join(process.cwd(), "data", "evals", "history.json");

function readHistory(): EvalRecord[] {
  try {
    return JSON.parse(fs.readFileSync(historyFile(), "utf8")) as EvalRecord[];
  } catch {
    return [];
  }
}

function writeHistory(records: EvalRecord[]): void {
  fs.mkdirSync(path.dirname(historyFile()), { recursive: true });
  fs.writeFileSync(historyFile(), JSON.stringify(records.slice(-HISTORY_LIMIT)));
}

function spawnEval(): Promise<EvalReport> {
  const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  return new Promise((resolve, reject) => {
    execFile(
      tsx,
      ["scripts/eval.ts", "--json"],
      { cwd: process.cwd(), timeout: EVAL_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env: { ...process.env, DEMO_STEP_DELAY_MS: "0", DISABLE_WORKER: "1" } },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`Eval process failed: ${stderr.trim().split("\n").at(-1) ?? err.message}`));
        try {
          resolve(JSON.parse(stdout) as EvalReport);
        } catch {
          reject(new Error("Eval process returned unreadable output"));
        }
      },
    );
  });
}

export function getEvalState(): EvalState {
  const history = readHistory();
  return {
    running: state().running !== null,
    error: state().error,
    latest: history.at(-1) ?? null,
    history: history.map((r) => ({
      startedAt: r.report.startedAt,
      score: r.report.score,
      optimisation: r.report.optimisation,
      efficiency: r.report.efficiency,
      engine: r.report.engine,
      ledgerSeq: r.ledgerSeq,
    })),
  };
}

/** Starts an eval unless one is already running. Resolves when the result is recorded. */
export function startEval(requestedBy: string): Promise<EvalRecord> {
  const s = state();
  if (s.running) return s.running;
  s.error = null;
  s.running = spawnEval()
    .then((report) => {
      const entry = appendEntry({
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
      const record = { report, ledgerSeq: entry.seq };
      writeHistory([...readHistory(), record]);
      return record;
    })
    .catch((err: unknown) => {
      s.error = err instanceof Error ? err.message : String(err);
      console.error("[eval] run failed", err);
      throw err;
    })
    .finally(() => {
      s.running = null;
    });
  return s.running;
}
