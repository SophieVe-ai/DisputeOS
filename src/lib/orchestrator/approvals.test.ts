import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AS_OF, freshEnvironment } from "@/test/helpers";
import { listEntries } from "../ledger/ledger";
import { getCase } from "../repo/cases";
import { listProposals } from "../repo/proposals";
import { getRun } from "../repo/runs";
import { ApprovalRequiredError, DecisionError, decideProposal, executeProposal, ForbiddenError } from "./approvals";
import { runToCompletion, startRun } from "./runner";

async function pendingProposals() {
  const run = startRun("case-northbank-lumen", "tester");
  await runToCompletion(run.id, AS_OF);
  return { runId: run.id, proposals: listProposals(run.id) };
}

describe("approval gate", () => {
  beforeEach(() => {
    freshEnvironment({ seed: true });
  });
  afterEach(() => {
    delete process.env.APPROVAL_PIN;
  });

  it("refuses to execute an action without human approval", async () => {
    const { proposals } = await pendingProposals();
    expect(() => executeProposal(proposals[0].id)).toThrow(ApprovalRequiredError);
    expect(listProposals(proposals[0].runId)[0].status).toBe("pending");
  });

  it("executes on approval and records the human decision on the ledger", async () => {
    const { proposals } = await pendingProposals();
    const result = decideProposal({ proposalId: proposals[0].id, decision: "approve", approver: "Priya", note: "OK", pin: null });
    expect(result.status).toBe("executed");
    expect(result.executionResult).toContain("finance@lumen-events.example");
    const actions = listEntries({ caseId: "case-northbank-lumen" }).map((e) => `${e.actor} ${e.action}`);
    expect(actions).toContain("human:Priya approval.granted");
    expect(actions).toContain("system:executor action.executed");
  });

  it("completes the run once every proposal is decided", async () => {
    const { runId, proposals } = await pendingProposals();
    decideProposal({ proposalId: proposals[0].id, decision: "approve", approver: "Priya", note: null, pin: null });
    expect(getRun(runId)?.status).toBe("awaiting_approval");
    decideProposal({ proposalId: proposals[1].id, decision: "reject", approver: "Priya", note: "Wait for LBA", pin: null });
    expect(getRun(runId)?.status).toBe("completed");
    expect(getCase("case-northbank-lumen")?.status).toBe("resolved");
    expect(() => decideProposal({ proposalId: proposals[1].id, decision: "approve", approver: "x", note: null, pin: null })).toThrow(DecisionError);
  });

  it("leaves the case open when everything is rejected", async () => {
    const { proposals } = await pendingProposals();
    proposals.forEach((p) => decideProposal({ proposalId: p.id, decision: "reject", approver: "Priya", note: null, pin: null }));
    expect(getCase("case-northbank-lumen")?.status).toBe("open");
  });

  it("enforces the approval PIN when configured", async () => {
    process.env.APPROVAL_PIN = "2468";
    const { proposals } = await pendingProposals();
    expect(() => decideProposal({ proposalId: proposals[0].id, decision: "approve", approver: "x", note: null, pin: "0000" })).toThrow(ForbiddenError);
    expect(decideProposal({ proposalId: proposals[0].id, decision: "approve", approver: "x", note: null, pin: "2468" }).status).toBe("executed");
  });
});
