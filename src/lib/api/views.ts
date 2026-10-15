// Read models assembled for the UI.
import { config } from "../config";
import { anchorError, getAnchor } from "../ledger/anchor-registry";
import { ledgerStats } from "../ledger/ledger";
import { getLlm } from "../agents/llm";
import { workerStatus } from "../orchestrator/worker";
import { getDocuments, getCase, listCases } from "../repo/cases";
import { countPendingProposals, listProposals } from "../repo/proposals";
import { currentDemandPence } from "../negotiation/agent";
import { listMessages } from "../repo/correspondence";
import { getSteps, latestRunForCase } from "../repo/runs";
import { listWakeups, nextScheduledWakeup } from "../repo/wakeups";
import type { ChallengeOutput } from "../types";

export function caseSummaries() {
  return listCases().map((c) => {
    const run = latestRunForCase(c.id);
    const challenge = run ? (getSteps(run.id)[2]?.output as ChallengeOutput | null) : null;
    return {
      ...c,
      run: run ? { id: run.id, status: run.status, stepIndex: run.stepIndex } : null,
      defensiblePrincipalPence: challenge?.defensiblePrincipalPence ?? null,
      confidence: challenge?.confidence ?? null,
    };
  });
}

export function caseDetail(id: string) {
  const caseFile = getCase(id);
  if (!caseFile) return null;
  const run = latestRunForCase(id);
  const proposals = run ? listProposals(run.id) : [];
  const challenge = run ? (getSteps(run.id)[2]?.output as ChallengeOutput | null) : null;
  return {
    case: caseFile,
    documents: getDocuments(id),
    run,
    steps: run ? getSteps(run.id) : [],
    proposals,
    negotiation: {
      demandPence: currentDemandPence(proposals.filter((p) => p.status === "executed")),
      floorPence: challenge?.defensiblePrincipalPence ?? null,
    },
    correspondence: run ? listMessages(run.id) : [],
    turns: run ? listWakeups(run.id) : [],
    nextWakeup: run ? nextScheduledWakeup(run.id) : null,
  };
}

export async function systemStatus() {
  const anchor = await getAnchor();
  const llm = getLlm();
  const cases = caseSummaries();
  return {
    engine: llm ? { mode: "claude" as const, model: llm.model } : { mode: "deterministic" as const, model: null },
    chain: anchor ? { connected: true, ...anchor.info(), error: null } : { connected: false, error: anchorError() },
    worker: workerStatus(),
    ledger: ledgerStats(),
    demoMode: config.demoMode,
    approvalPinRequired: Boolean(config.approvalPin),
    baseRatePercent: config.boeBaseRatePercent,
    stats: {
      cases: cases.length,
      claimedPence: cases.reduce((s, c) => s + c.claimedAmountPence, 0),
      defensiblePence: cases.reduce((s, c) => s + (c.defensiblePrincipalPence ?? 0), 0),
      awaitingApproval: countPendingProposals(),
      active: cases.filter((c) => c.run && ["queued", "running"].includes(c.run.status)).length,
    },
  };
}
