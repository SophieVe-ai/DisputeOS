// Durable run state machine. Each call to `advanceRun` executes exactly one agent step
// and persists its output, so a run survives restarts and resumes where it left off.
import { config } from "../config";
import { nowIso } from "../db";
import { getLlm } from "../agents/llm";
import type { AgentContext } from "../agents/context";
import { appendEntry } from "../ledger/ledger";
import { todayIso } from "../money";
import { getCase, getDocuments, setCaseStatus } from "../repo/cases";
import { insertProposals } from "../repo/proposals";
import { activeRunForCase, getRun, getSteps, insertRun, updateRun, updateStep } from "../repo/runs";
import { AGENT_NAMES, type ChallengeOutput, type EvidenceOutput, type ReconciliationOutput, type ResolutionOutput, type Run } from "../types";
import { AGENTS } from "./registry";

export const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 2_000;

export class RunConflictError extends Error {}

export async function startRun(caseId: string, requestedBy: string): Promise<Run> {
  const caseFile = await getCase(caseId);
  if (!caseFile) throw new Error(`Case ${caseId} not found`);
  const active = await activeRunForCase(caseId);
  if (active) throw new RunConflictError(`Case already has an active run (${active.status})`);
  const run = await insertRun(caseId);
  await setCaseStatus(caseId, "in_review");
  await appendEntry({ caseId, runId: run.id, actor: `human:${requestedBy}`, action: "run.requested", payload: { agents: AGENT_NAMES } });
  return run;
}

async function priorOutputs(runId: string): Promise<AgentContext["prior"]> {
  const byAgent = Object.fromEntries((await getSteps(runId)).filter((s) => s.status === "done").map((s) => [s.agent, s.output]));
  return {
    evidence: byAgent.evidence as EvidenceOutput | undefined,
    reconciliation: byAgent.reconciliation as ReconciliationOutput | undefined,
    challenge: byAgent.challenge as ChallengeOutput | undefined,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function buildContext(run: Run, agentName: string, asOf: string = todayIso()): Promise<AgentContext> {
  const caseFile = await getCase(run.caseId);
  if (!caseFile) throw new Error(`Case ${run.caseId} not found`);
  const actor = `agent:${agentName}`;
  const documents = await getDocuments(run.caseId);
  const prior = await priorOutputs(run.id);
  return Object.freeze({
    caseFile: Object.freeze({ ...caseFile }),
    documents: Object.freeze(documents.map((d) => Object.freeze(d))),
    asOf,
    baseRatePercent: config.boeBaseRatePercent,
    prior: Object.freeze(prior),
    llm: getLlm(),
    log: async (action: string, payload?: unknown) => {
      await appendEntry({ caseId: run.caseId, runId: run.id, actor, action, payload: payload ?? null });
    },
    pace: (fraction = 1) => sleep(config.stepDelayMs * fraction),
  });
}

/** Executes the next pending agent for the run. Returns the updated run. */
export async function advanceRun(runId: string, asOf?: string): Promise<Run> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== "running" && run.status !== "queued") return run;
  const agentName = AGENT_NAMES[run.stepIndex];
  const agent = AGENTS[agentName];
  await updateStep(runId, run.stepIndex, { status: "running", startedAt: nowIso(), error: null });
  try {
    const ctx = await buildContext(run, agentName, asOf);
    const { output, engine } = await agent.run(ctx);
    await updateStep(runId, run.stepIndex, { status: "done", engine, output, finishedAt: nowIso() });
    await appendEntry({ caseId: run.caseId, runId, actor: `agent:${agentName}`, action: `${agentName}.completed`, payload: { engine, output } });
    const nextIndex = run.stepIndex + 1;
    if (nextIndex < AGENT_NAMES.length) {
      await updateRun(runId, { stepIndex: nextIndex, attempts: 0, leaseUntil: null, error: null });
    } else {
      await finishPipeline(run, output as ResolutionOutput);
    }
  } catch (err) {
    await handleFailure(run, err);
  }
  return (await getRun(runId))!;
}

async function finishPipeline(run: Run, resolution: ResolutionOutput): Promise<void> {
  const proposals = await insertProposals(run.id, run.caseId, resolution.proposals);
  await updateRun(run.id, { stepIndex: AGENT_NAMES.length, status: "awaiting_approval", leaseUntil: null, attempts: 0 });
  await setCaseStatus(run.caseId, "awaiting_approval");
  await appendEntry({
    caseId: run.caseId,
    runId: run.id,
    actor: "system:orchestrator",
    action: "run.awaiting_approval",
    payload: { proposals: proposals.map((p) => ({ id: p.id, kind: p.kind, amountPence: p.amountPence })) },
  });
}

async function handleFailure(run: Run, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const attempts = run.attempts + 1;
  const agentName = AGENT_NAMES[run.stepIndex];
  const exhausted = attempts >= MAX_ATTEMPTS;
  await updateStep(run.id, run.stepIndex, { status: exhausted ? "failed" : "pending", error: message });
  await appendEntry({ caseId: run.caseId, runId: run.id, actor: `agent:${agentName}`, action: `${agentName}.failed`, payload: { attempt: attempts, error: message } });
  if (exhausted) {
    await updateRun(run.id, { status: "failed", attempts, error: message, leaseUntil: null });
    await setCaseStatus(run.caseId, "open");
    await appendEntry({ caseId: run.caseId, runId: run.id, actor: "system:orchestrator", action: "run.failed", payload: { error: message } });
  } else {
    const retryAt = new Date(Date.now() + RETRY_BASE_MS * 2 ** attempts).toISOString();
    await updateRun(run.id, { attempts, error: message, leaseUntil: retryAt });
  }
}

/** Runs a pipeline to completion in-process (used by tests, the eval and the CLI). */
export async function runToCompletion(runId: string, asOf?: string): Promise<Run> {
  let run = (await getRun(runId))!;
  await updateRun(runId, { status: "running" });
  for (let guard = 0; guard < AGENT_NAMES.length * MAX_ATTEMPTS; guard++) {
    run = await advanceRun(runId, asOf);
    if (run.status !== "running") break;
  }
  return run;
}
