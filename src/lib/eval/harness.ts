// Agent evaluation harness. Each scenario runs end-to-end in an isolated in-memory
// database with an in-memory chain, then is scored on two axes:
//   optimisation — did the agents reach the legally correct outcome?
//   efficiency   — how cheaply did they get there (time, retries, fallbacks, ledger writes)?
import { performance } from "node:perf_hooks";
import { formatPence } from "../money";
import { getLlm } from "../agents/llm";
import { openDb, withDb } from "../db";
import { MemoryAnchor } from "../ledger/anchor";
import { withAnchor } from "../ledger/anchor-registry";
import { appendEntry, listEntries, syncAnchors, verifyLedger } from "../ledger/ledger";
import { runToCompletion, startRun } from "../orchestrator/runner";
import { createCase } from "../repo/cases";
import { listProposals } from "../repo/proposals";
import { getSteps } from "../repo/runs";
import { AGENT_NAMES, type ChallengeOutput, type ReconciliationOutput } from "../types";
import { EVAL_AS_OF, SCENARIOS, type Scenario } from "./scenarios";

export const OPTIMISATION_WEIGHT = 0.7;
export const EFFICIENCY_WEIGHT = 0.3;
/** Wall-clock budget per pipeline run, by engine. */
export const LATENCY_BUDGET_MS = { deterministic: 750, claude: 90_000 } as const;
/** Ledger writes we consider proportionate: fixed overhead plus a little per document. */
const LEDGER_BASE_BUDGET = 16;
const LEDGER_PER_DOC_BUDGET = 2;

export interface Check {
  name: string;
  weight: number;
  /** 0..1 — continuous for amounts, binary otherwise. */
  score: number;
  expected: string;
  actual: string;
}

export interface EfficiencyMetric {
  name: string;
  score: number;
  value: string;
  budget: string;
}

export interface ScenarioResult {
  id: string;
  name: string;
  tests: string;
  source: Scenario["source"];
  status: "completed" | "failed";
  error: string | null;
  optimisation: number;
  efficiency: number;
  score: number;
  durationMs: number;
  checks: Check[];
  metrics: EfficiencyMetric[];
}

export interface EvalReport {
  score: number;
  optimisation: number;
  efficiency: number;
  engine: "deterministic" | "claude";
  model: string | null;
  asOf: string;
  startedAt: string;
  durationMs: number;
  passed: number;
  total: number;
  checksPassed: number;
  checksTotal: number;
  scenarios: ScenarioResult[];
}

const pct = (n: number) => Math.round(n * 1000) / 10;
const pounds = formatPence;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const weighted = (checks: { weight: number; score: number }[]) =>
  checks.reduce((s, c) => s + c.weight * c.score, 0) / Math.max(1e-9, checks.reduce((s, c) => s + c.weight, 0));

/** 1 when exact, falling linearly to 0 at a 100% relative error. */
export function amountAccuracy(actual: number, expected: number): number {
  if (expected === 0) return actual === 0 ? 1 : 0;
  return Math.max(0, 1 - Math.abs(actual - expected) / Math.abs(expected));
}

/** Order-aware overlap: Jaccard similarity, docked if the order differs. */
export function sequenceSimilarity<T>(actual: T[], expected: T[]): number {
  const a = new Set(actual);
  const e = new Set(expected);
  const union = new Set([...a, ...e]).size;
  if (union === 0) return 1;
  const jaccard = [...a].filter((x) => e.has(x)).length / union;
  const ordered = actual.length === expected.length && actual.every((x, i) => x === expected[i]);
  return ordered ? jaccard : jaccard * 0.85;
}

/**
 * Runs a scenario in its own throwaway database and in-memory chain. Both are scoped to this
 * call tree (AsyncLocalStorage), so an eval can run inside the live server without ever
 * touching live cases, the live ledger or the real chain.
 */
async function runScenario(scenario: Scenario, engine: EvalReport["engine"]): Promise<ScenarioResult> {
  const db = await openDb("memory://");
  try {
    return await withDb(db, () => withAnchor(new MemoryAnchor(), () => runScenarioIsolated(scenario, engine)));
  } finally {
    await db.close();
  }
}

async function runScenarioIsolated(scenario: Scenario, engine: EvalReport["engine"]): Promise<ScenarioResult> {
  const base = { id: scenario.id, name: scenario.name, tests: scenario.tests, source: scenario.source };
  const exp = scenario.expected;
  const started = performance.now();
  try {
    const input = await scenario.load();
    const created = await createCase(input, input.id);
    await appendEntry({ caseId: created.id, runId: null, actor: "system:intake", action: "case.opened", payload: { evaluation: scenario.id } });
    const run = await startRun(created.id, "evaluator");
    const finished = await runToCompletion(run.id, EVAL_AS_OF);
    await syncAnchors();
    await syncAnchors();
    const durationMs = performance.now() - started;

    const steps = await getSteps(run.id);
    const recon = steps.find((s) => s.agent === "reconciliation")?.output as ReconciliationOutput | undefined;
    const challenge = steps.find((s) => s.agent === "challenge")?.output as ChallengeOutput | undefined;
    const proposals = (await listProposals(run.id)).map((p) => p.kind);
    const entries = await listEntries({ caseId: created.id, limit: 2000 });
    const verification = await verifyLedger(created.id);

    const checks: Check[] = [];
    if (exp.documentKinds) {
      const got = input.documents.map((d) => d.kind);
      const right = got.filter((k, i) => k === exp.documentKinds![i]).length;
      checks.push({ name: "Document classification", weight: 1, score: right / exp.documentKinds.length, expected: `${exp.documentKinds.length}/${exp.documentKinds.length} correct`, actual: `${right}/${exp.documentKinds.length} correct` });
    }
    checks.push(
      { name: "Supported principal", weight: 2, score: recon?.supportedPrincipalPence === exp.supportedPrincipalPence ? 1 : 0, expected: pounds(exp.supportedPrincipalPence), actual: recon ? pounds(recon.supportedPrincipalPence) : "—" },
      { name: "Days overdue", weight: 1, score: recon?.daysOverdue === exp.daysOverdue ? 1 : 0, expected: String(exp.daysOverdue), actual: recon ? String(recon.daysOverdue) : "—" },
      { name: "Defensible principal", weight: 3, score: challenge ? amountAccuracy(challenge.defensiblePrincipalPence, exp.defensiblePrincipalPence) : 0, expected: pounds(exp.defensiblePrincipalPence), actual: challenge ? pounds(challenge.defensiblePrincipalPence) : "—" },
      { name: "Recommendation", weight: 2, score: challenge?.recommendation === exp.recommendation ? 1 : 0, expected: exp.recommendation, actual: challenge?.recommendation ?? "—" },
    );
    for (const v of exp.verdicts) {
      const hit = challenge?.challenges.find((c) => c.title.toLowerCase().includes(v.titleIncludes.toLowerCase()));
      checks.push({ name: `Verdict: ${v.titleIncludes}`, weight: 1, score: hit?.verdict === v.verdict ? 1 : 0, expected: v.verdict, actual: hit?.verdict ?? "not raised" });
    }
    checks.push(
      { name: "Proposed actions", weight: 2, score: sequenceSimilarity(proposals, exp.proposalKinds), expected: exp.proposalKinds.join(" → "), actual: proposals.join(" → ") || "none" },
      { name: "Audit trail verified on-chain", weight: 1, score: verification.ok ? 1 : 0, expected: "all entries match anchors", actual: verification.ok ? `${verification.checked} entries match` : `${verification.failures} failures` },
    );

    const failures = entries.filter((e) => e.action.endsWith(".failed")).length;
    const fallbacks = entries.filter((e) => e.action.endsWith("_fallback")).length;
    const latencyBudget = LATENCY_BUDGET_MS[engine];
    const ledgerBudget = LEDGER_BASE_BUDGET + LEDGER_PER_DOC_BUDGET * input.documents.length;
    const metrics: EfficiencyMetric[] = [
      { name: "Pipeline latency", score: Math.min(1, latencyBudget / Math.max(1, durationMs)), value: `${Math.round(durationMs)} ms`, budget: `${latencyBudget} ms` },
      { name: "First-attempt success", score: AGENT_NAMES.length / (AGENT_NAMES.length + failures), value: `${failures} retries`, budget: "0 retries" },
      { name: "Model fallbacks", score: 1 - Math.min(1, fallbacks / AGENT_NAMES.length), value: `${fallbacks} fallbacks`, budget: "0 fallbacks" },
      { name: "Ledger writes", score: Math.min(1, ledgerBudget / Math.max(1, entries.length)), value: `${entries.length} writes`, budget: `≤ ${ledgerBudget} writes` },
    ];

    const optimisation = finished.status === "awaiting_approval" ? weighted(checks) : 0;
    const efficiency = mean(metrics.map((m) => m.score));
    return {
      ...base,
      status: "completed",
      error: null,
      optimisation: pct(optimisation),
      efficiency: pct(efficiency),
      score: pct(OPTIMISATION_WEIGHT * optimisation + EFFICIENCY_WEIGHT * efficiency),
      durationMs: Math.round(durationMs),
      checks,
      metrics,
    };
  } catch (err) {
    return { ...base, status: "failed", error: err instanceof Error ? err.message : String(err), optimisation: 0, efficiency: 0, score: 0, durationMs: Math.round(performance.now() - started), checks: [], metrics: [] };
  }
}

export async function runEval(opts: { scenarios?: Scenario[]; onProgress?: (r: ScenarioResult) => void } = {}): Promise<EvalReport> {
  const llm = getLlm();
  const engine = llm ? "claude" : "deterministic";
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const scenarios: ScenarioResult[] = [];
  for (const scenario of opts.scenarios ?? SCENARIOS) {
    const result = await runScenario(scenario, engine);
    scenarios.push(result);
    opts.onProgress?.(result);
  }
  const optimisation = mean(scenarios.map((s) => s.optimisation));
  const efficiency = mean(scenarios.map((s) => s.efficiency));
  const allChecks = scenarios.flatMap((s) => s.checks);
  return {
    score: Math.round((OPTIMISATION_WEIGHT * optimisation + EFFICIENCY_WEIGHT * efficiency) * 10) / 10,
    optimisation: Math.round(optimisation * 10) / 10,
    efficiency: Math.round(efficiency * 10) / 10,
    engine,
    model: llm?.model ?? null,
    asOf: EVAL_AS_OF,
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    passed: scenarios.filter((s) => s.status === "completed" && s.checks.every((c) => c.score === 1)).length,
    total: scenarios.length,
    checksPassed: allChecks.filter((c) => c.score === 1).length,
    checksTotal: allChecks.length,
    scenarios,
  };
}
