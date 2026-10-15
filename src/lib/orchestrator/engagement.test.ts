import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { AS_OF, freshEnvironment } from "@/test/helpers";
import { setLlmForTesting, type StructuredRequest } from "../agents/llm";
import { listEntries } from "../ledger/ledger";
import { negotiationAgent } from "../negotiation/agent";
import { getCase } from "../repo/cases";
import { listMessages } from "../repo/correspondence";
import { listProposals } from "../repo/proposals";
import { getRun, getSteps } from "../repo/runs";
import { claimDueWakeup, listWakeups, nextScheduledWakeup } from "../repo/wakeups";
import type { ChallengeOutput, ProposalKind } from "../types";
import { decideProposal } from "./approvals";
import { closeEngagement, EngagementError, fastForward, MAX_TURN_ATTEMPTS, processWakeup, recordReply } from "./engagement";
import { runToCompletion, startRun } from "./runner";

const NORTHBANK = "case-northbank-lumen"; // clean debt: LBA + court pack
const DAY_MS = 86_400_000;

/** Runs the pipeline, approves the letter before action and rejects the rest. */
async function engage(caseId = NORTHBANK, approve: ProposalKind[] = ["send_letter_before_action"]) {
  const run = startRun(caseId, "tester");
  await runToCompletion(run.id, AS_OF);
  for (const p of listProposals(run.id)) {
    decideProposal({ proposalId: p.id, decision: approve.includes(p.kind) ? "approve" : "reject", approver: "Priya", note: null, pin: null });
  }
  const challenge = getSteps(run.id)[2].output as ChallengeOutput;
  return { runId: run.id, floor: challenge.defensiblePrincipalPence };
}

async function nextTurn() {
  const claimed = claimDueWakeup(60_000);
  expect(claimed).not.toBeNull();
  return processWakeup(claimed!.id, AS_OF);
}

const pending = (runId: string) => listProposals(runId).filter((p) => p.status === "pending");
const approvePending = (runId: string) =>
  pending(runId).forEach((p) => decideProposal({ proposalId: p.id, decision: "approve", approver: "Priya", note: null, pin: null }));
const actions = (caseId = NORTHBANK) => listEntries({ caseId }).map((e) => `${e.actor} ${e.action}`);
const reply = (body: string, caseId = NORTHBANK) => recordReply(caseId, { from: "Lumen Events", subject: null, body });

describe("long-running engagement", () => {
  beforeEach(() => {
    freshEnvironment({ seed: true });
  });
  afterEach(() => {
    setLlmForTesting(null);
    vi.restoreAllMocks();
  });

  it("sending the letter before action puts the run to sleep with a 14-day follow-up timer", async () => {
    const { runId } = await engage();
    expect(getRun(runId)?.status).toBe("awaiting_response");
    expect(getCase(NORTHBANK)?.status).toBe("awaiting_response");
    const [letter] = listMessages(runId);
    expect(letter).toMatchObject({ direction: "outbound", sender: "Northbank Print Co", subject: "Letter before action" });
    const timer = nextScheduledWakeup(runId)!;
    expect(timer.kind).toBe("deadline");
    expect(Date.parse(timer.dueAt) - Date.now()).toBeGreaterThan(13.9 * DAY_MS);
    expect(claimDueWakeup(60_000)).toBeNull(); // nothing due yet: the agent sleeps
    expect(actions()).toEqual(expect.arrayContaining(["system:scheduler followup.scheduled", "system:orchestrator run.awaiting_response"]));
  });

  it("a low counter-offer wakes the agent, which counters at the defensible principal", async () => {
    const { runId, floor } = await engage();
    reply("We are prepared to pay £3,000 in full and final settlement.");
    const turn = await nextTurn();
    expect(turn.status).toBe("done");
    expect(turn.output).toMatchObject({ decision: "counter_offer", floorPence: floor, analysis: { intent: "counter_offer", amountPence: 300_000 } });
    const [proposal] = pending(runId);
    expect(proposal).toMatchObject({ kind: "offer_settlement", amountPence: floor, turnId: turn.id, followUpDays: 14 });
    expect(getRun(runId)?.status).toBe("awaiting_approval");
    expect(nextScheduledWakeup(runId)).toBeNull(); // old timer superseded by the new move
    approvePending(runId);
    expect(getRun(runId)?.status).toBe("awaiting_response");
    expect(nextScheduledWakeup(runId)?.kind).toBe("deadline");
    expect(listMessages(runId).map((m) => m.direction)).toEqual(["outbound", "inbound", "outbound"]);
  });

  it("negotiates to settlement: accept a fair offer, then close once payment is reported", async () => {
    const { runId, floor } = await engage();
    reply(`We can offer £${(floor / 100).toFixed(2)} to settle this.`);
    await nextTurn();
    expect(pending(runId)[0]).toMatchObject({ kind: "accept_offer", amountPence: floor });
    approvePending(runId);
    reply(`We have paid £${(floor / 100).toFixed(2)} by bank transfer today.`);
    await nextTurn();
    expect(pending(runId)[0].kind).toBe("close_case");
    approvePending(runId);
    expect(getRun(runId)?.status).toBe("completed");
    expect(getCase(NORTHBANK)?.status).toBe("resolved");
    expect(listWakeups(runId).filter((w) => w.status === "scheduled")).toHaveLength(0);
    expect(actions()).toContain("system:orchestrator run.completed");
  });

  it("silence: the deadline wakes the agent for a final reminder, then escalation", async () => {
    const { runId } = await engage();
    expect(fastForward(NORTHBANK)).not.toBeNull();
    const first = await nextTurn();
    expect(first.output?.decision).toBe("remind");
    approvePending(runId);
    fastForward(NORTHBANK);
    const second = await nextTurn();
    expect(second.output?.decision).toBe("escalate");
    approvePending(runId);
    expect(getCase(NORTHBANK)?.status).toBe("escalated");
    expect(actions()).toContain("system:demo-clock clock.fast_forwarded");
  });

  it("a reply that arrives while a decision is pending waits for the gate to clear", async () => {
    const { runId } = await engage();
    reply("Please send us a copy of the signed proof of delivery.");
    await nextTurn();
    reply("Also, we will pay by 25 October 2026.");
    expect(claimDueWakeup(60_000)).toBeNull();
    approvePending(runId);
    const turn = await nextTurn();
    expect(turn.output).toMatchObject({ decision: "confirm_promise", analysis: { promisedDate: "2026-10-25" } });
  });

  it("an acknowledgement changes nothing and keeps the existing timer", async () => {
    const { runId } = await engage();
    const timer = nextScheduledWakeup(runId)!;
    reply("Thanks, passing this to our accounts team.");
    const turn = await nextTurn();
    expect(turn.output).toMatchObject({ decision: "wait", proposals: [] });
    expect(getRun(runId)?.status).toBe("awaiting_response");
    expect(nextScheduledWakeup(runId)?.id).toBe(timer.id);
  });

  it("rejecting every follow-up keeps waiting with a routine follow-up", async () => {
    const { runId } = await engage();
    reply("We dispute this invoice; the goods were never received.");
    await nextTurn();
    pending(runId).forEach((p) => decideProposal({ proposalId: p.id, decision: "reject", approver: "Priya", note: null, pin: null }));
    expect(getRun(runId)?.status).toBe("awaiting_response");
    expect(nextScheduledWakeup(runId)?.reason).toBe("routine follow-up");
  });

  it("refuses a reply before anything has been sent, and blocks re-runs while engaged", async () => {
    expect(() => reply("Hello")).toThrow(EngagementError);
    await engage();
    expect(() => startRun(NORTHBANK, "tester")).toThrow(/active run/);
  });

  it("a human can stop the follow-up and close the case", async () => {
    const { runId } = await engage();
    closeEngagement(NORTHBANK, "Priya");
    expect(getRun(runId)?.status).toBe("completed");
    expect(getCase(NORTHBANK)?.status).toBe("closed");
    expect(nextScheduledWakeup(runId)).toBeNull();
    expect(actions()).toContain("human:Priya run.closed");
    expect(() => closeEngagement(NORTHBANK, "Priya")).toThrow(EngagementError);
  });

  it("retries a failing turn, then gives up but keeps a timer so the case never stalls", async () => {
    const { runId } = await engage();
    vi.spyOn(negotiationAgent, "run").mockRejectedValue(new Error("boom"));
    const { wakeup } = reply("We will pay soon.");
    for (let i = 0; i < MAX_TURN_ATTEMPTS; i++) {
      // Skip the retry backoff: make the wake-up due again and lease it.
      const claimed = claimDueWakeup(60_000) ?? (await forceDue(wakeup.id));
      await processWakeup(claimed.id, AS_OF);
    }
    expect(listWakeups(runId).find((w) => w.id === wakeup.id)).toMatchObject({ status: "failed", attempts: MAX_TURN_ATTEMPTS });
    expect(nextScheduledWakeup(runId)).not.toBeNull();
    expect(actions().filter((a) => a === "agent:negotiation negotiation.failed")).toHaveLength(MAX_TURN_ATTEMPTS);
  });

  it("leases one turn per case at a time and recovers an expired lease", async () => {
    const { runId } = await engage();
    reply("Thanks.");
    reply("Please send a statement of account.");
    const first = claimDueWakeup(60_000)!;
    expect(claimDueWakeup(60_000)).toBeNull(); // same case: second reply waits its turn
    const { getDb } = await import("../db");
    getDb().prepare("UPDATE run_wakeups SET lease_until = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), first.id);
    expect(claimDueWakeup(60_000)?.id).toBe(first.id);
    expect(listWakeups(runId).filter((w) => w.status === "processing")).toHaveLength(1);
  });

  it("uses Claude to read the reply and polish the letter, keeping the exact figures", async () => {
    const { runId, floor } = await engage();
    setLlmForTesting({
      model: "fake",
      structured: async <S extends z.ZodType>(req: StructuredRequest<S>) => {
        const body = req.system.includes("Classify")
          ? { intent: "counter_offer", amountAsWritten: "£2,000", dateAsWritten: null, promisedDateIso: null, disputeTypes: [], quote: "we could stretch to £2,000" }
          : { letter: `Polished. We will accept ${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(floor / 100)}.` };
        return req.schema.parse(body);
      },
    });
    reply("Honestly we could stretch to £2,000 and no more.");
    const turn = await nextTurn();
    expect(turn.engine).toBe("claude");
    expect(turn.output?.analysis).toMatchObject({ source: "claude", amountPence: 200_000 });
    expect(pending(runId)[0].documentBody).toMatch(/^Polished\./);
  });

  it("falls back to the rules engine and template when Claude fails", async () => {
    const { runId } = await engage();
    setLlmForTesting({ model: "fake", structured: async () => Promise.reject(new Error("overloaded")) });
    reply("We are prepared to pay £3,000 in full and final settlement.");
    const turn = await nextTurn();
    expect(turn.engine).toBe("deterministic");
    expect(turn.output?.analysis?.source).toBe("rules");
    expect(pending(runId)[0].documentBody).toContain("# Without Prejudice");
    expect(actions().filter((a) => a === "agent:negotiation negotiation.claude_fallback")).toHaveLength(2);
  });
});

describe("engagement race conditions", () => {
  beforeEach(() => {
    freshEnvironment({ seed: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it("closing while a turn is in flight discards its result instead of reviving the case", async () => {
    const { runId } = await engage();
    reply("We are prepared to pay £3,000 in full and final settlement.");
    const claimed = claimDueWakeup(60_000)!;
    const real = negotiationAgent.run.bind(negotiationAgent);
    vi.spyOn(negotiationAgent, "run").mockImplementation(async (ctx) => {
      closeEngagement(NORTHBANK, "Priya"); // the human stops follow-up mid-turn
      return real(ctx);
    });
    await processWakeup(claimed.id, AS_OF);
    expect(getRun(runId)?.status).toBe("completed");
    expect(getCase(NORTHBANK)?.status).toBe("closed");
    expect(pending(runId)).toHaveLength(0);
    expect(listWakeups(runId).find((w) => w.id === claimed.id)?.status).toBe("cancelled");
    expect(actions()).toContain("agent:negotiation negotiation.discarded");
  });

  it("a queued reply is read before a deadline that is already due", async () => {
    const { runId } = await engage();
    reply("Please send us a copy of the signed proof of delivery.");
    await nextTurn();
    reply("We have paid in full today."); // queued: a decision is pending
    approvePending(runId); // arms a fresh deadline; force it due too
    await forceScheduledDeadline(runId);
    const turn = await nextTurn();
    expect(turn.kind).toBe("reply");
  });

  it("ending the engagement records replies that were never answered", async () => {
    const { runId } = await engage();
    fastForward(NORTHBANK);
    await nextTurn(); // reminder drafted
    approvePending(runId);
    fastForward(NORTHBANK);
    await nextTurn(); // escalation drafted
    reply("Wait, we have paid!"); // arrives while the escalation awaits approval
    approvePending(runId);
    const completed = listEntries({ caseId: NORTHBANK }).find((e) => e.action === "run.completed")!;
    expect(completed.payload).toMatchObject({ unreadReplies: 1, outcome: "escalate_court_claim" });
  });

  it("a turn whose lease keeps expiring is abandoned instead of retrying forever", async () => {
    const { runId } = await engage();
    const { wakeup } = reply("Thanks.");
    const { getDb } = await import("../db");
    const expire = () => getDb().prepare("UPDATE run_wakeups SET lease_until = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), wakeup.id);
    claimDueWakeup(60_000);
    for (let i = 0; i < MAX_TURN_ATTEMPTS; i++) {
      expire();
      claimDueWakeup(60_000); // each reclaim of an expired lease counts as a failed attempt
    }
    await processWakeup(wakeup.id, AS_OF);
    expect(listWakeups(runId).find((w) => w.id === wakeup.id)?.status).toBe("failed");
    expect(nextScheduledWakeup(runId)).not.toBeNull();
  });

  it("a turn that outlives its lease does not land twice", async () => {
    const { runId } = await engage();
    reply("We are prepared to pay £3,000 in full and final settlement.");
    const first = claimDueWakeup(60_000)!;
    const { getDb } = await import("../db");
    const real = negotiationAgent.run.bind(negotiationAgent);
    let reclaimed: string | undefined;
    vi.spyOn(negotiationAgent, "run").mockImplementationOnce(async (ctx) => {
      // While this (slow) turn runs, its lease expires and the worker reclaims it.
      getDb().prepare("UPDATE run_wakeups SET lease_until = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), first.id);
      reclaimed = claimDueWakeup(60_000)?.id;
      return real(ctx);
    });
    await processWakeup(first.id, AS_OF); // stale copy finishes: must not commit
    expect(reclaimed).toBe(first.id);
    expect(pending(runId)).toHaveLength(0);
    expect(actions()).toContain("agent:negotiation negotiation.discarded");
    await processWakeup(first.id, AS_OF); // the live copy commits
    expect(pending(runId)).toHaveLength(1);
  });
});

async function forceScheduledDeadline(runId: string) {
  const { getDb } = await import("../db");
  getDb().prepare("UPDATE run_wakeups SET due_at = ? WHERE run_id = ? AND kind = 'deadline' AND status = 'scheduled'").run(new Date(Date.now() - 60_000).toISOString(), runId);
}

async function forceDue(id: string) {
  const { getDb } = await import("../db");
  getDb().prepare("UPDATE run_wakeups SET status = 'processing', due_at = ?, lease_until = ? WHERE id = ?").run(new Date().toISOString(), new Date(Date.now() + 60_000).toISOString(), id);
  return { id };
}
