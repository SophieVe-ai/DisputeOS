import { beforeEach, describe, expect, it, vi } from "vitest";
import { AS_OF, freshEnvironment } from "@/test/helpers";
import { listEntries } from "../ledger/ledger";
import { getCase } from "../repo/cases";
import { listProposals } from "../repo/proposals";
import { claimNextRun, getRun, getSteps, updateRun } from "../repo/runs";
import type { ChallengeOutput, ReconciliationOutput } from "../types";
import { AGENTS } from "./registry";
import { advanceRun, MAX_ATTEMPTS, RunConflictError, runToCompletion, startRun } from "./runner";

async function runCase(caseId: string) {
  const run = startRun(caseId, "tester");
  const done = await runToCompletion(run.id, AS_OF);
  const steps = getSteps(run.id);
  return {
    run: done,
    recon: steps[1].output as ReconciliationOutput,
    challenge: steps[2].output as ChallengeOutput,
    proposals: listProposals(run.id),
  };
}

describe("agent pipeline", () => {
  beforeEach(() => {
    freshEnvironment({ seed: true });
  });

  it("Harbour Joinery: upholds the in-time damage claim and rebuts the late one", async () => {
    const { run, recon, challenge, proposals } = await runCase("case-harbour-kestrel");
    expect(run.status).toBe("awaiting_approval");
    expect(recon.supportedPrincipalPence).toBe(1_292_000);
    expect(recon.daysOverdue).toBe(102);
    const damage = challenge.challenges.find((c) => c.title.includes("damaged"));
    expect(damage).toMatchObject({ verdict: "upheld", impactPence: 115_500 });
    expect(challenge.challenges.find((c) => c.title.includes("poor quality"))?.verdict).toBe("rebutted");
    expect(challenge.defensiblePrincipalPence).toBe(1_176_500);
    expect(challenge.recommendation).toBe("pursue_reduced");
    expect(proposals.map((p) => p.kind)).toEqual(["send_letter_before_action", "offer_settlement", "prepare_court_claim"]);
    expect(proposals[0].documentBody).toContain("£11,765.00");
    expect(getCase("case-harbour-kestrel")?.status).toBe("awaiting_approval");
  });

  it("Northbank Print: clean debt is pursued in full", async () => {
    const { recon, challenge, proposals } = await runCase("case-northbank-lumen");
    expect(recon.supportedPrincipalPence).toBe(675_000);
    expect(challenge.recommendation).toBe("pursue_full");
    expect(challenge.defensiblePrincipalPence).toBe(675_000);
    expect(proposals.map((p) => p.kind)).toEqual(["send_letter_before_action", "prepare_court_claim"]);
  });

  it("Peak Catering: catches our own overcharge and short delivery", async () => {
    const { recon, challenge, proposals } = await runCase("case-peak-ashford");
    expect(recon.overchargePence).toBe(50_000);
    expect(recon.shortDeliveryPence).toBe(11_400);
    expect(recon.supportedPrincipalPence).toBe(892_600);
    expect(challenge.challenges.filter((c) => c.verdict === "upheld")).toHaveLength(2);
    expect(proposals[0]).toMatchObject({ kind: "issue_credit_note", amountPence: 61_400 });
    expect(proposals.map((p) => p.kind)).not.toContain("prepare_court_claim");
  });

  it("logs every agent action to the ledger with a fixed actor", async () => {
    await runCase("case-northbank-lumen");
    const actions = listEntries({ caseId: "case-northbank-lumen" }).map((e) => `${e.actor} ${e.action}`);
    for (const agent of ["evidence", "reconciliation", "challenge", "resolution"]) {
      expect(actions).toContain(`agent:${agent} ${agent}.completed`);
    }
    expect(actions).toContain("system:orchestrator run.awaiting_approval");
    expect(actions.filter((a) => a.includes("evidence.document_reviewed"))).toHaveLength(5);
  });

  it("refuses a second concurrent run for the same case", () => {
    startRun("case-peak-ashford", "tester");
    expect(() => startRun("case-peak-ashford", "tester")).toThrow(RunConflictError);
  });

  it("retries a failing agent and fails the run after max attempts", async () => {
    const spy = vi.spyOn(AGENTS.evidence, "run").mockRejectedValue(new Error("boom"));
    const run = startRun("case-peak-ashford", "tester");
    updateRun(run.id, { status: "running" });
    let current = await advanceRun(run.id, AS_OF);
    expect(current.status).toBe("running");
    expect(current.attempts).toBe(1);
    for (let i = 1; i < MAX_ATTEMPTS; i++) current = await advanceRun(run.id, AS_OF);
    expect(current.status).toBe("failed");
    expect(getCase("case-peak-ashford")?.status).toBe("open");
    spy.mockRestore();
  });

  it("agent context is read-only", async () => {
    const spy = vi.spyOn(AGENTS.evidence, "run").mockImplementation(async (ctx) => {
      expect(Object.isFrozen(ctx)).toBe(true);
      expect(Object.isFrozen(ctx.caseFile)).toBe(true);
      expect(() => {
        (ctx as unknown as { log: unknown }).log = () => undefined;
      }).toThrow();
      throw new Error("stop");
    });
    const run = startRun("case-peak-ashford", "tester");
    updateRun(run.id, { status: "running" });
    await advanceRun(run.id, AS_OF);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("worker leasing", () => {
  beforeEach(() => {
    freshEnvironment({ seed: true });
  });

  it("leases a run exactly once until the lease expires (crash recovery)", () => {
    const run = startRun("case-peak-ashford", "tester");
    const claimed = claimNextRun(60_000);
    expect(claimed?.id).toBe(run.id);
    expect(claimNextRun(60_000)).toBeNull();
    updateRun(run.id, { leaseUntil: new Date(Date.now() - 1000).toISOString() });
    expect(claimNextRun(60_000)?.id).toBe(run.id);
    expect(getRun(run.id)?.status).toBe("running");
  });
});
