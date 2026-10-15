import { beforeEach, describe, expect, it } from "vitest";
import { AS_OF, freshEnvironment } from "@/test/helpers";
import { decideProposal as decide } from "../orchestrator/approvals";
import { runToCompletion, startRun } from "../orchestrator/runner";
import { listProposals } from "../repo/proposals";
import { actorName, describeEntry } from "./describe";
import { appendEntry, listEntries } from "./ledger";

describe("describeEntry", () => {
  beforeEach(() => {
    freshEnvironment({ seed: true });
  });

  it("gives every action in a full run a specific plain-English sentence", async () => {
    const run = startRun("case-harbour-kestrel", "Megan Hughes");
    await runToCompletion(run.id, AS_OF);
    const [first, second] = listProposals(run.id);
    decide({ proposalId: first.id, decision: "approve", approver: "Megan Hughes", note: null, pin: null });
    decide({ proposalId: second.id, decision: "reject", approver: "Megan Hughes", note: "not yet", pin: null });
    const entries = listEntries({ caseId: "case-harbour-kestrel", limit: 500 });
    const generic = entries.filter((e) => e.description.includes(`: ${e.action.replace(/_/g, " ").replace(".", " ")}`));
    expect(generic.map((e) => e.action)).toEqual([]);
    const text = entries.map((e) => e.description);
    expect(text).toContain("Megan Hughes started the agent pipeline.");
    expect(text).toContain("Reviewed “Invoice HJ-1042” (invoice) and recorded its fingerprint.");
    expect(text.some((t) => t.startsWith("Raised “Debtor alleges damaged goods") && t.includes("deducting £1,155.00"))).toBe(true);
    expect(text.some((t) => t.startsWith("Challenge finished: £11,765.00 is defensible at"))).toBe(true);
    expect(text.some((t) => t.startsWith("Megan Hughes approved: send letter before action"))).toBe(true);
    expect(text.some((t) => t.includes("rejected") && t.includes("“not yet”"))).toBe(true);
  });

  it("describes intake, eval and failure entries and falls back gracefully", () => {
    expect(describeEntry({ actor: "system:intake", action: "case.opened", payload: { reference: "DOS-1", documents: 1, claimedAmountPence: 12_345 } })).toBe(
      "Case DOS-1 opened with 1 document, claiming £123.45.",
    );
    expect(describeEntry({ actor: "system:evaluator", action: "eval.completed", payload: { score: 97.5, optimisation: 100, efficiency: 91.7, checks: "38/38" } })).toBe(
      "Agent eval scored 97.5% (optimisation 100%, efficiency 91.7%, 38/38 checks).",
    );
    expect(describeEntry({ actor: "agent:evidence", action: "evidence.failed", payload: { attempt: 2, error: "timeout" } })).toBe("Evidence agent failed (attempt 2): timeout.");
    expect(describeEntry({ actor: "agent:challenge", action: "challenge.claude_fallback", payload: null })).toBe("Claude was unavailable, so the challenge agent used the rules engine instead.");
    expect(describeEntry({ actor: "system:custom", action: "thing.happened", payload: "x" })).toBe("Custom: thing happened.");
    expect(describeEntry({ actor: "agent:evidence", action: "evidence.completed", payload: "tampered" })).toBe(
      "Evidence agent finished: 0 documents reviewed, 0 debtor complaints found, 0 evidence gaps.",
    );
  });

  it("names actors for people", () => {
    expect(actorName("agent:reconciliation")).toBe("Reconciliation agent");
    expect(actorName("human:Megan Hughes")).toBe("Megan Hughes");
    expect(actorName("system:executor")).toBe("Executor");
  });

  it("is exposed on every ledger entry", () => {
    const e = appendEntry({ caseId: null, runId: null, actor: "system:orchestrator", action: "run.completed", payload: { executed: 1, rejected: 2 } });
    expect(e.description).toBe("Run closed: 1 executed, 2 rejected.");
  });
});
