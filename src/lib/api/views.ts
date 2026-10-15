// Read models assembled for the UI.
import { config } from "../config";
import { anchorError, getAnchor } from "../ledger/anchor-registry";
import { ledgerStats } from "../ledger/ledger";
import { getLlm } from "../agents/llm";
import { currentDemandPence } from "../negotiation/agent";
import { workerStatus } from "../orchestrator/worker";
import { getDocuments, getCase, listCases } from "../repo/cases";
import { listMessages } from "../repo/correspondence";
import { countPendingProposals, listProposals } from "../repo/proposals";
import { getSteps, latestRunForCase } from "../repo/runs";
import { listWakeups, nextScheduledWakeup } from "../repo/wakeups";
import type { ChallengeOutput } from "../types";

export async function caseSummaries() {
  return Promise.all(
    (await listCases()).map(async (c) => {
      const run = await latestRunForCase(c.id);
      const challenge = run ? ((await getSteps(run.id))[2]?.output as ChallengeOutput | null) : null;
      return {
        ...c,
        run: run ? { id: run.id, status: run.status, stepIndex: run.stepIndex } : null,
        defensiblePrincipalPence: challenge?.defensiblePrincipalPence ?? null,
        confidence: challenge?.confidence ?? null,
      };
    }),
  );
}

export async function caseDetail(id: string) {
  const caseFile = await getCase(id);
  if (!caseFile) return null;
  const run = await latestRunForCase(id);
  if (!run) {
    return { case: caseFile, documents: await getDocuments(id), run, steps: [], proposals: [], negotiation: { demandPence: null, floorPence: null }, correspondence: [], turns: [], nextWakeup: null };
  }
  const [documents, steps, proposals, correspondence, turns, nextWakeup] = await Promise.all([
    getDocuments(id),
    getSteps(run.id),
    listProposals(run.id),
    listMessages(run.id),
    listWakeups(run.id),
    nextScheduledWakeup(run.id),
  ]);
  const challenge = steps[2]?.output as ChallengeOutput | null;
  return {
    case: caseFile,
    documents,
    run,
    steps,
    proposals,
    negotiation: {
      demandPence: currentDemandPence(proposals.filter((p) => p.status === "executed")),
      floorPence: challenge?.defensiblePrincipalPence ?? null,
    },
    correspondence,
    turns,
    nextWakeup,
  };
}

export async function systemStatus() {
  const anchor = await getAnchor();
  const llm = getLlm();
  const [cases, ledger, awaitingApproval] = await Promise.all([caseSummaries(), ledgerStats(), countPendingProposals()]);
  return {
    engine: llm ? { mode: "claude" as const, model: llm.model } : { mode: "deterministic" as const, model: null },
    chain: anchor ? { connected: true, ...anchor.info(), error: null } : { connected: false, error: anchorError() },
    worker: workerStatus(),
    ledger,
    demoMode: config.demoMode,
    approvalPinRequired: Boolean(config.approvalPin),
    baseRatePercent: config.boeBaseRatePercent,
    stats: {
      cases: cases.length,
      claimedPence: cases.reduce((s, c) => s + c.claimedAmountPence, 0),
      defensiblePence: cases.reduce((s, c) => s + (c.defensiblePrincipalPence ?? 0), 0),
      awaitingApproval,
      active: cases.filter((c) => c.run && ["queued", "running"].includes(c.run.status)).length,
    },
  };
}
