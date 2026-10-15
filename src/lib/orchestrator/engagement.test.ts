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
  const run = await startRun(caseId, "tester");
  await runToCompletion(run.id, AS_OF);
  for (const p of await listProposals(run.id)) {
    await decideProposal({ proposalId: p.id, decision: approve.includes(p.kind) ? "approve" : "reject", approver: "Priya", note: null, pin: null });
  }
  const challenge = (await getSteps(run.id))[2].output as ChallengeOutput;
  return { runId: run.id, floor: challenge.defensiblePrincipalPence };
}

async function nextTurn() {
  const claimed = await claimDueWakeup(60_000);
  expect(claimed).not.toBeNull();
  return processWakeup(claimed!.id, AS_OF);
}

const pending = async (runId: string) => (await listProposals(runId)).filter((p) => p.status === "pending");
async function approvePending(runId: string) {
  for (const p of await pending(runId)) await decideProposal({ proposalId: p.id, decision: "approve", approver: "Priya", note: null, pin: null });
}
const actions = async (caseId = NORTHBANK) => (await listEntries({ caseId })).map((e) => `${e.actor} ${e.action}`);
const reply = (body: string, caseId = NORTHBANK) => recordReply(caseId, { from: "Lumen Events", subject: null, body });

describe("long-running engagement", () => {
  beforeEach(async () => {
    await freshEnvironment({ seed: true });
  });
  afterEach(() => {
    setLlmForTesting(null);
    vi.restoreAllMocks();
  });

  it("sending the letter before action puts the run to sleep with a 14-day follow-up timer", async () => {
    const { runId } = await engage();
    expect((await getRun(runId))?.status).toBe("awaiting_response");
    expect((await getCase(NORTHBANK))?.status).toBe("awaiting_response");
    const [letter] = await listMessages(runId);
    expect(letter).toMatchObject({ direction: "outbound", sender: "Northbank Print Co", subject: "Letter before action" });
    const timer = (await nextScheduledWakeup(runId))!;
    expect(timer.kind).toBe("deadline");
    expect(Date.parse(timer.dueAt) - Date.now()).toBeGreaterThan(13.9 * DAY_MS);
    expect(await claimDueWakeup(60_000)).toBeNull(); // nothing due yet: the agent sleeps
    expect(await actions()).toEqual(expect.arrayContaining(["system:scheduler followup.scheduled", "system:orchestrator run.awaiting_response"]));
  });

  it("a low counter-offer wakes the agent, which counters at the defensible principal", async () => {
    const { runId, floor } = await engage();
    await reply("We are prepared to pay £3,000 in full and final settlement.");
    const turn = await nextTurn();
    expect(turn.status).toBe("done");
    expect(turn.output).toMatchObject({ decision: "counter_offer", floorPence: floor, analysis: { intent: "counter_offer", amountPence: 300_000 } });
    const [proposal] = await pending(runId);
    expect(proposal).toMatchObject({ kind: "offer_settlement", amountPence: floor, turnId: turn.id, followUpDays: 14 });
    expect((await getRun(runId))?.status).toBe("awaiting_approval");
    expect(await nextScheduledWakeup(runId)).toBeNull(); // old timer superseded by the new move
    await approvePending(runId);
    expect((await getRun(runId))?.status).toBe("awaiting_response");
    expect((await nextScheduledWakeup(runId))?.kind).toBe("deadline");
    expect((await listMessages(runId)).map((m) => m.direction)).toEqual(["outbound", "inbound", "outbound"]);
  });

  it("negotiates to settlement: accept a fair offer, then close once payment is reported", async () => {
    const { runId, floor } = await engage();
    await reply(`We can offer £${(floor / 100).toFixed(2)} to settle this.`);
    await nextTurn();
    expect((await pending(runId))[0]).toMatchObject({ kind: "accept_offer", amountPence: floor });
    await approvePending(runId);
    await reply(`We have paid £${(floor / 100).toFixed(2)} by bank transfer today.`);
    await nextTurn();
    expect((await pending(runId))[0].kind).toBe("close_case");
    await approvePending(runId);
    expect((await getRun(runId))?.status).toBe("completed");
    expect((await getCase(NORTHBANK))?.status).toBe("resolved");
    expect((await listWakeups(runId)).filter((w) => w.status === "scheduled")).toHaveLength(0);
    expect(await actions()).toContain("system:orchestrator run.completed");
  });

  it("silence: the deadline wakes the agent for a final reminder, then escalation", async () => {
    const { runId } = await engage();
    expect(await fastForward(NORTHBANK)).not.toBeNull();
    const first = await nextTurn();
    expect(first.output?.decision).toBe("remind");
    await approvePending(runId);
    await fastForward(NORTHBANK);
    const second = await nextTurn();
    expect(second.output?.decision).toBe("escalate");
    await approvePending(runId);
    expect((await getCase(NORTHBANK))?.status).toBe("escalated");
    expect(await actions()).toContain("system:demo-clock clock.fast_forwarded");
  });

  it("a reply that arrives while a decision is pending waits for the gate to clear", async () => {
    const { runId } = await engage();
    await reply("Please send us a copy of the signed proof of delivery.");
    await nextTurn();
    await reply("Also, we will pay by 25 October 2026.");
    expect(await claimDueWakeup(60_000)).toBeNull();
    await approvePending(runId);
    const turn = await nextTurn();
    expect(turn.output).toMatchObject({ decision: "confirm_promise", analysis: { promisedDate: "2026-10-25" } });
  });

  it("an acknowledgement changes nothing and keeps the existing timer", async () => {
    const { runId } = await engage();
    const timer = (await nextScheduledWakeup(runId))!;
    await reply("Thanks, passing this to our accounts team.");
    const turn = await nextTurn();
    expect(turn.output).toMatchObject({ decision: "wait", proposals: [] });
    expect((await getRun(runId))?.status).toBe("awaiting_response");
    expect((await nextScheduledWakeup(runId))?.id).toBe(timer.id);
  });

  it("rejecting every follow-up keeps waiting with a routine follow-up", async () => {
    const { runId } = await engage();
    await reply("We dispute this invoice; the goods were never received.");
    await nextTurn();
    for (const p of await pending(runId)) await decideProposal({ proposalId: p.id, decision: "reject", approver: "Priya", note: null, pin: null });
    expect((await getRun(runId))?.status).toBe("awaiting_response");
    expect((await nextScheduledWakeup(runId))?.reason).toBe("routine follow-up");
  });

  it("refuses a reply before anything has been sent, and blocks re-runs while engaged", async () => {
    await expect(reply("Hello")).rejects.toThrow(EngagementError);
    await engage();
    await expect(startRun(NORTHBANK, "tester")).rejects.toThrow(/active run/);
  });

  it("a human can stop the follow-up and close the case", async () => {
    const { runId } = await engage();
    await closeEngagement(NORTHBANK, "Priya");
    expect((await getRun(runId))?.status).toBe("completed");
    expect((await getCase(NORTHBANK))?.status).toBe("closed");
    expect(await nextScheduledWakeup(runId)).toBeNull();
    expect(await actions()).toContain("human:Priya run.closed");
    await expect(closeEngagement(NORTHBANK, "Priya")).rejects.toThrow(EngagementError);
  });

  it("retries a failing turn, then gives up but keeps a timer so the case never stalls", async () => {
    const { runId } = await engage();
    vi.spyOn(negotiationAgent, "run").mockRejectedValue(new Error("boom"));
    const { wakeup } = await reply("We will pay soon.");
    for (let i = 0; i < MAX_TURN_ATTEMPTS; i++) {
      // Skip the retry backoff: make the wake-up due again and lease it.
      const claimed = (await claimDueWakeup(60_000)) ?? (await forceDue(wakeup.id));
      await processWakeup(claimed.id, AS_OF);
    }
    expect((await listWakeups(runId)).find((w) => w.id === wakeup.id)).toMatchObject({ status: "failed", attempts: MAX_TURN_ATTEMPTS });
    expect(await nextScheduledWakeup(runId)).not.toBeNull();
    expect((await actions()).filter((a) => a === "agent:negotiation negotiation.failed")).toHaveLength(MAX_TURN_ATTEMPTS);
  });

  it("leases one turn per case at a time and recovers an expired lease", async () => {
    const { runId } = await engage();
    await reply("Thanks.");
    await reply("Please send a statement of account.");
    const first = (await claimDueWakeup(60_000))!;
    expect(await claimDueWakeup(60_000)).toBeNull(); // same case: second reply waits its turn
    const { getDb } = await import("../db");
    await (await getDb()).run("UPDATE run_wakeups SET lease_until = ? WHERE id = ?", [new Date(Date.now() - 1000).toISOString(), first.id]);
    expect((await claimDueWakeup(60_000))?.id).toBe(first.id);
    expect((await listWakeups(runId)).filter((w) => w.status === "processing")).toHaveLength(1);
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
    await reply("Honestly we could stretch to £2,000 and no more.");
    const turn = await nextTurn();
    expect(turn.engine).toBe("claude");
    expect(turn.output?.analysis).toMatchObject({ source: "claude", amountPence: 200_000 });
    expect((await pending(runId))[0].documentBody).toMatch(/^Polished\./);
  });

  it("falls back to the rules engine and template when Claude fails", async () => {
    const { runId } = await engage();
    setLlmForTesting({ model: "fake", structured: async () => Promise.reject(new Error("overloaded")) });
    await reply("We are prepared to pay £3,000 in full and final settlement.");
    const turn = await nextTurn();
    expect(turn.engine).toBe("deterministic");
    expect(turn.output?.analysis?.source).toBe("rules");
    expect((await pending(runId))[0].documentBody).toContain("# Without Prejudice");
    expect((await actions()).filter((a) => a === "agent:negotiation negotiation.claude_fallback")).toHaveLength(2);
  });
});

describe("engagement race conditions", () => {
  beforeEach(async () => {
    await freshEnvironment({ seed: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it("closing while a turn is in flight discards its result instead of reviving the case", async () => {
    const { runId } = await engage();
    await reply("We are prepared to pay £3,000 in full and final settlement.");
    const claimed = (await claimDueWakeup(60_000))!;
    const real = negotiationAgent.run.bind(negotiationAgent);
    vi.spyOn(negotiationAgent, "run").mockImplementation(async (ctx) => {
      await closeEngagement(NORTHBANK, "Priya"); // the human stops follow-up mid-turn
      return real(ctx);
    });
    await processWakeup(claimed.id, AS_OF);
    expect((await getRun(runId))?.status).toBe("completed");
    expect((await getCase(NORTHBANK))?.status).toBe("closed");
    expect(await pending(runId)).toHaveLength(0);
    expect((await listWakeups(runId)).find((w) => w.id === claimed.id)?.status).toBe("cancelled");
    expect(await actions()).toContain("agent:negotiation negotiation.discarded");
  });

  it("a queued reply is read before a deadline that is already due", async () => {
    const { runId } = await engage();
    await reply("Please send us a copy of the signed proof of delivery.");
    await nextTurn();
    await reply("We have paid in full today."); // queued: a decision is pending
    await approvePending(runId); // arms a fresh deadline; force it due too
    await forceScheduledDeadline(runId);
    const turn = await nextTurn();
    expect(turn.kind).toBe("reply");
  });

  it("ending the engagement records replies that were never answered", async () => {
    const { runId } = await engage();
    await fastForward(NORTHBANK);
    await nextTurn(); // reminder drafted
    await approvePending(runId);
    await fastForward(NORTHBANK);
    await nextTurn(); // escalation drafted
    await reply("Wait, we have paid!"); // arrives while the escalation awaits approval
    await approvePending(runId);
    const completed = (await listEntries({ caseId: NORTHBANK })).find((e) => e.action === "run.completed")!;
    expect(completed.payload).toMatchObject({ unreadReplies: 1, outcome: "escalate_court_claim" });
  });

  it("a turn whose lease keeps expiring is abandoned instead of retrying forever", async () => {
    const { runId } = await engage();
    const { wakeup } = await reply("Thanks.");
    const { getDb } = await import("../db");
    const expire = async () => (await getDb()).run("UPDATE run_wakeups SET lease_until = ? WHERE id = ?", [new Date(Date.now() - 1000).toISOString(), wakeup.id]);
    await claimDueWakeup(60_000);
    for (let i = 0; i < MAX_TURN_ATTEMPTS; i++) {
      await expire();
      await claimDueWakeup(60_000); // each reclaim of an expired lease counts as a failed attempt
    }
    await processWakeup(wakeup.id, AS_OF);
    expect((await listWakeups(runId)).find((w) => w.id === wakeup.id)?.status).toBe("failed");
    expect(await nextScheduledWakeup(runId)).not.toBeNull();
  });

  it("a turn that outlives its lease does not land twice", async () => {
    const { runId } = await engage();
    await reply("We are prepared to pay £3,000 in full and final settlement.");
    const first = (await claimDueWakeup(60_000))!;
    const { getDb } = await import("../db");
    const real = negotiationAgent.run.bind(negotiationAgent);
    let reclaimed: string | undefined;
    vi.spyOn(negotiationAgent, "run").mockImplementationOnce(async (ctx) => {
      // While this (slow) turn runs, its lease expires and the worker reclaims it.
      await (await getDb()).run("UPDATE run_wakeups SET lease_until = ? WHERE id = ?", [new Date(Date.now() - 1000).toISOString(), first.id]);
      reclaimed = (await claimDueWakeup(60_000))?.id;
      return real(ctx);
    });
    await processWakeup(first.id, AS_OF); // stale copy finishes: must not commit
    expect(reclaimed).toBe(first.id);
    expect(await pending(runId)).toHaveLength(0);
    expect(await actions()).toContain("agent:negotiation negotiation.discarded");
    await processWakeup(first.id, AS_OF); // the live copy commits
    expect(await pending(runId)).toHaveLength(1);
  });
});

async function forceScheduledDeadline(runId: string) {
  const { getDb } = await import("../db");
  await (await getDb()).run("UPDATE run_wakeups SET due_at = ? WHERE run_id = ? AND kind = 'deadline' AND status = 'scheduled'", [new Date(Date.now() - 60_000).toISOString(), runId]);
}

async function forceDue(id: string) {
  const { getDb } = await import("../db");
  await (await getDb()).run("UPDATE run_wakeups SET status = 'processing', due_at = ?, lease_until = ? WHERE id = ?", [new Date().toISOString(), new Date(Date.now() + 60_000).toISOString(), id]);
  return { id };
}
