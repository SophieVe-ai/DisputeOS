import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AS_OF, freshEnvironment } from "@/test/helpers";
import { listEntries } from "../ledger/ledger";
import { getCase } from "../repo/cases";
import { listProposals } from "../repo/proposals";
import { getRun } from "../repo/runs";
import { ApprovalRequiredError, DecisionError, decideProposal, executeProposal, ForbiddenError } from "./approvals";
import { runToCompletion, startRun } from "./runner";

async function pendingProposals() {
  const run = await startRun("case-northbank-lumen", "tester");
  await runToCompletion(run.id, AS_OF);
  return { runId: run.id, proposals: await listProposals(run.id) };
}

describe("approval gate", () => {
  beforeEach(async () => {
    await freshEnvironment({ seed: true });
  });
  afterEach(() => {
    delete process.env.APPROVAL_PIN;
  });

  it("refuses to execute an action without human approval", async () => {
    const { proposals } = await pendingProposals();
    await expect(executeProposal(proposals[0].id)).rejects.toThrow(ApprovalRequiredError);
    expect((await listProposals(proposals[0].runId))[0].status).toBe("pending");
  });

  it("executes on approval and records the human decision on the ledger", async () => {
    const { proposals } = await pendingProposals();
    const result = await decideProposal({ proposalId: proposals[0].id, decision: "approve", approver: "Priya", note: "OK", pin: null });
    expect(result.status).toBe("executed");
    expect(result.executionResult).toContain("finance@lumen-events.example");
    const actions = (await listEntries({ caseId: "case-northbank-lumen" })).map((e) => `${e.actor} ${e.action}`);
    expect(actions).toContain("human:Priya approval.granted");
    expect(actions).toContain("system:executor action.executed");
  });

  it("completes the run once every proposal is decided and no reply is expected", async () => {
    const { runId, proposals } = await pendingProposals();
    await decideProposal({ proposalId: proposals[1].id, decision: "approve", approver: "Priya", note: null, pin: null });
    expect((await getRun(runId))?.status).toBe("awaiting_approval");
    await decideProposal({ proposalId: proposals[0].id, decision: "reject", approver: "Priya", note: "Hold the letter", pin: null });
    expect((await getRun(runId))?.status).toBe("completed");
    expect((await getCase("case-northbank-lumen"))?.status).toBe("resolved");
    await expect(decideProposal({ proposalId: proposals[0].id, decision: "approve", approver: "x", note: null, pin: null })).rejects.toThrow(DecisionError);
  });

  it("keeps the run alive, waiting for the debtor, once a letter expecting a reply is sent", async () => {
    const { runId, proposals } = await pendingProposals();
    for (const p of proposals) {
      await decideProposal({ proposalId: p.id, decision: p.kind === "send_letter_before_action" ? "approve" : "reject", approver: "Priya", note: null, pin: null });
    }
    expect((await getRun(runId))?.status).toBe("awaiting_response");
    expect((await getCase("case-northbank-lumen"))?.status).toBe("awaiting_response");
  });

  it("leaves the case open when everything is rejected", async () => {
    const { proposals } = await pendingProposals();
    for (const p of proposals) {
      await decideProposal({ proposalId: p.id, decision: "reject", approver: "Priya", note: null, pin: null });
    }
    expect((await getCase("case-northbank-lumen"))?.status).toBe("open");
  });

  it("enforces the approval PIN when configured", async () => {
    process.env.APPROVAL_PIN = "2468";
    const { proposals } = await pendingProposals();
    await expect(decideProposal({ proposalId: proposals[0].id, decision: "approve", approver: "x", note: null, pin: "0000" })).rejects.toThrow(ForbiddenError);
    expect((await decideProposal({ proposalId: proposals[0].id, decision: "approve", approver: "x", note: null, pin: "2468" })).status).toBe("executed");
  });
});
