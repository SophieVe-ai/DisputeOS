import { describe, expect, it } from "vitest";
import type { LlmClient, StructuredRequest } from "../agents/llm";
import { describeEntry } from "../ledger/describe";
import type { Challenge, DisputeCase, ReplyAnalysis } from "../types";
import { classifyReplyRules, classifyReplyWithClaude, findDate } from "./classify";
import { followUpDocument, type FollowUpLetterInput } from "./letters";
import { decideNextMove, MAX_COUNTER_OFFERS, type PolicyInput } from "./policy";

const AS_OF = "2026-10-15";

describe("reply classifier (rules)", () => {
  it.each([
    ["We have paid £6,750.00 by bank transfer today, reference LUM-449.", "paid", 675_000],
    ["We are prepared to pay £5,000 in full and final settlement.", "counter_offer", 500_000],
    ["We will pay the outstanding balance by 25 October 2026.", "promise_to_pay", null],
    ["We dispute this invoice. Several units were damaged on arrival.", "dispute", null],
    ["We will not pay this invoice and reject your claim entirely.", "refusal", null],
    ["Please send us a copy of the signed proof of delivery.", "request_info", null],
    ["Thanks, I am out of the office until Monday.", "acknowledgement", null],
  ])("reads “%s” as %s", (text, intent, amount) => {
    const a = classifyReplyRules(text, AS_OF);
    expect(a.intent).toBe(intent);
    expect(a.amountPence).toBe(amount);
    expect(a.source).toBe("rules");
  });

  it("an offer without a figure is not a counter-offer", () => {
    expect(classifyReplyRules("We would like to propose a way forward and will pay by 20/10/2026.", AS_OF).intent).toBe("promise_to_pay");
  });

  it("extracts the promised date and the disputed points", () => {
    expect(classifyReplyRules("We will pay you by 25th October.", AS_OF).promisedDate).toBe("2026-10-25");
    expect(classifyReplyRules("We dispute the invoice: items were damaged and we were overcharged.", AS_OF).disputeTypes).toEqual(["damage", "pricing"]);
    expect(classifyReplyRules("We dispute this.", AS_OF).disputeTypes).toEqual(["other"]);
  });

  it("parses ISO, UK and named dates, rolling a past day-month into next year", () => {
    expect(findDate("by 2026-11-01", AS_OF)?.iso).toBe("2026-11-01");
    expect(findDate("by 03/11/2026", AS_OF)?.iso).toBe("2026-11-03");
    expect(findDate("by 2 March", AS_OF)?.iso).toBe("2027-03-02");
    expect(findDate("no date here", AS_OF)).toBeNull();
  });
});

function fakeLlm(response: unknown): LlmClient {
  return { model: "fake", structured: async <S extends import("zod").z.ZodType>(req: StructuredRequest<S>) => req.schema.parse(response) };
}

describe("reply classifier (Claude, grounded)", () => {
  const reply = "Following our call, we can offer £7,500.00 to settle, payable by 30 October 2026.";

  it("keeps figures and dates that appear in the reply", async () => {
    const llm = fakeLlm({ intent: "counter_offer", amountAsWritten: "£7,500.00", dateAsWritten: "30 October 2026", promisedDateIso: "2026-10-30", disputeTypes: [], quote: "we can offer £7,500.00 to settle" });
    const a = await classifyReplyWithClaude(llm, reply, AS_OF);
    expect(a).toMatchObject({ intent: "counter_offer", amountPence: 750_000, promisedDate: "2026-10-30", source: "claude", rejected: 0 });
  });

  it("discards an invented figure and date, and replaces an invented quote", async () => {
    const llm = fakeLlm({ intent: "counter_offer", amountAsWritten: "£8,000", dateAsWritten: "1 November", promisedDateIso: "2026-11-01", disputeTypes: [], quote: "We offer eight thousand." });
    const a = await classifyReplyWithClaude(llm, reply, AS_OF);
    expect(a.amountPence).toBeNull();
    expect(a.promisedDate).toBeNull();
    expect(a.rejected).toBe(2);
    expect(reply).toContain(a.quote.replace("…", ""));
  });
});

const base: PolicyInput = { trigger: "reply", analysis: null, demandPence: 1_000_000, floorPence: 800_000, remindersSent: 0, counterOffersMade: 0, assessedDisputeTypes: ["damage"], asOf: AS_OF };
const reply = (partial: Partial<ReplyAnalysis>): ReplyAnalysis => ({ intent: "acknowledgement", amountPence: null, promisedDate: null, disputeTypes: [], quote: "", source: "rules", rejected: 0, ...partial });
const decide = (partial: Partial<ReplyAnalysis>, extra: Partial<PolicyInput> = {}) => decideNextMove({ ...base, analysis: reply(partial), ...extra });

describe("negotiation policy", () => {
  it("silence: one reminder, then escalation (or closure when nothing is defensible)", () => {
    expect(decideNextMove({ ...base, trigger: "deadline" }).action).toMatchObject({ kind: "send_reminder", amountPence: 1_000_000, followUpDays: 7 });
    expect(decideNextMove({ ...base, trigger: "deadline", remindersSent: 1 }).action).toMatchObject({ kind: "escalate_court_claim", followUpDays: null });
    expect(decideNextMove({ ...base, trigger: "deadline", remindersSent: 1, floorPence: 0 }).action?.kind).toBe("close_case");
  });

  it("offers: accept at or above the floor, counter below it, escalate when stalled", () => {
    expect(decide({ intent: "counter_offer", amountPence: 800_000 })).toMatchObject({ decision: "accept_offer", action: { kind: "accept_offer", amountPence: 800_000 } });
    expect(decide({ intent: "counter_offer", amountPence: 500_000 })).toMatchObject({ decision: "counter_offer", action: { kind: "offer_settlement", amountPence: 800_000 } });
    expect(decide({ intent: "counter_offer", amountPence: 500_000 }, { counterOffersMade: MAX_COUNTER_OFFERS }).decision).toBe("escalate");
    expect(decide({ intent: "counter_offer" }).decision).toBe("hold_and_review");
  });

  it("payments: close when covered, chase the balance, or ask for remittance", () => {
    expect(decide({ intent: "paid", amountPence: 1_000_000 }).action?.kind).toBe("close_case");
    expect(decide({ intent: "paid", amountPence: 600_000 }).action).toMatchObject({ kind: "send_reply", amountPence: 400_000 });
    expect(decide({ intent: "paid" }).decision).toBe("request_remittance");
  });

  it("promises: confirm a near date (checking after a grace period), push back on a far or missing one", () => {
    expect(decide({ intent: "promise_to_pay", promisedDate: "2026-10-25" }).action).toMatchObject({ followUpDays: 12 });
    expect(decide({ intent: "promise_to_pay", promisedDate: "2027-01-30" }).decision).toBe("ask_for_date");
    expect(decide({ intent: "promise_to_pay" }).decision).toBe("ask_for_date");
  });

  it("disputes: rebut points already assessed, hold for review on new ones", () => {
    expect(decide({ intent: "dispute", disputeTypes: ["damage"] }).decision).toBe("rebut_dispute");
    expect(decide({ intent: "dispute", disputeTypes: ["non_receipt"] }).decision).toBe("hold_and_review");
  });

  it("refusal escalates, information requests get the evidence, acknowledgements wait", () => {
    expect(decide({ intent: "refusal" }).action?.kind).toBe("escalate_court_claim");
    expect(decide({ intent: "refusal" }, { floorPence: 0 }).action?.kind).toBe("close_case");
    expect(decide({ intent: "request_info" }).decision).toBe("send_evidence");
    expect(decide({ intent: "acknowledgement" })).toMatchObject({ decision: "wait", action: null });
  });
});

const caseFile: DisputeCase = { id: "c1", reference: "DOS-1", title: "Test", creditor: "Acme Ltd", debtor: "Beta Ltd", debtorEmail: "ap@beta.example", claimedAmountPence: 1, status: "awaiting_response", summary: "", createdAt: AS_OF };
const challenge: Challenge = { id: "C1", title: "Debtor alleges damaged goods", argument: "", severity: "low", basisDocId: null, verdict: "rebutted", rebuttal: "Raised outside the inspection period.", impactPence: 0, source: "rules" };
const letter = (partial: Partial<FollowUpLetterInput>): FollowUpLetterInput => ({
  caseFile, asOf: AS_OF, decision: "remind", amountPence: 1_000_000, followUpDays: 7, analysis: null, demandPence: 1_000_000, floorPence: 800_000,
  challenges: [challenge], documents: [{ title: "Invoice 1", kind: "invoice" }, { title: "Chaser", kind: "correspondence" }], claimPack: "# Particulars", ...partial,
});

describe("follow-up letters", () => {
  it("states the exact figure and deadline", () => {
    const doc = followUpDocument(letter({}));
    expect(doc.title).toBe("Send a final reminder for £10,000.00");
    expect(doc.body).toContain("£10,000.00");
    expect(doc.body).toContain("2026-10-22");
  });

  it("rebuts with the Challenge agent's findings and lists only evidence documents", () => {
    expect(followUpDocument(letter({ decision: "rebut_dispute", analysis: reply({ intent: "dispute", disputeTypes: ["damage"] }) })).body).toContain("Raised outside the inspection period.");
    const evidence = followUpDocument(letter({ decision: "send_evidence" })).body;
    expect(evidence).toContain("- Invoice 1");
    expect(evidence).not.toContain("Chaser");
  });

  it("escalation wraps the claim pack; closure tells the approver to check the bank", () => {
    expect(followUpDocument(letter({ decision: "escalate" })).body).toContain("# Particulars");
    expect(followUpDocument(letter({ decision: "close_settled", amountPence: 1_000_000 })).body).toContain("confirm the funds have cleared");
  });

  it.each(["accept_offer", "counter_offer", "confirm_promise", "ask_for_date", "chase_balance", "request_remittance", "hold_and_review"] as const)("drafts a %s letter", (decision) => {
    const doc = followUpDocument(letter({ decision, analysis: reply({ quote: "Their words.", promisedDate: "2026-10-25" }) }));
    expect(doc.body).toContain("£10,000.00");
    expect(doc.body).toContain("> Their words.");
  });
});

describe("ledger descriptions for the negotiation", () => {
  it.each([
    [{ actor: "counterparty:Beta Ltd", action: "correspondence.received", payload: { subject: "Re: invoice" } }, "Reply received from Beta Ltd: “Re: invoice”. The Negotiation agent has been woken to read it."],
    [{ actor: "agent:negotiation", action: "negotiation.started", payload: { trigger: "deadline", reason: "no reply" } }, "Negotiation agent woke up: a follow-up deadline passed (no reply)."],
    [{ actor: "agent:negotiation", action: "negotiation.reply_classified", payload: { intent: "counter_offer", amountPence: 500_000, source: "claude" } }, "Read the debtor's reply with Claude: counter offer, £5,000.00."],
    [{ actor: "agent:negotiation", action: "negotiation.position_assessed", payload: { demandPence: 100, floorPence: 50 } }, "Position: £1.00 on the table; will not settle below £0.50."],
    [{ actor: "agent:negotiation", action: "negotiation.completed", payload: { output: { decision: "wait", proposals: [] } } }, "Negotiation agent decided: wait. Nothing to send; still waiting."],
    [{ actor: "system:scheduler", action: "followup.scheduled", payload: { dueAt: "2026-10-29T10:00:00Z", days: 14, reason: "no reply" } }, "Follow-up timer set for 2026-10-29 (14 days): no reply."],
    [{ actor: "system:orchestrator", action: "run.completed", payload: { executed: 1, rejected: 0, outcome: "escalate_court_claim" } }, "Run closed: 1 executed, 0 rejected. Escalated to a court claim."],
    [{ actor: "human:Priya", action: "run.closed", payload: {} }, "Priya stopped the follow-up and closed the case."],
  ])("describes %j", (entry, text) => {
    expect(describeEntry(entry)).toBe(text);
  });
});

describe("database schema", () => {
  it("creates the negotiation and eval tables and the negotiation proposal columns", async () => {
    const { openDb } = await import("../db");
    const db = await openDb("memory://");
    try {
      const columns = (await db.all<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'proposals'")).map((c) => c.column_name);
      expect(columns).toEqual(expect.arrayContaining(["turn_id", "follow_up_days"]));
      const tables = await db.all<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('correspondence', 'run_wakeups', 'eval_runs')",
      );
      expect(tables.map((t) => t.table_name).sort()).toEqual(["correspondence", "eval_runs", "run_wakeups"]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("re-opening an existing database is idempotent and keeps its data", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { openDb } = await import("../db");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "disputeos-schema-"));
    try {
      const first = await openDb(dir);
      await first.run("INSERT INTO cases (id, reference, title, creditor, debtor, claimed_amount_pence, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["c1", "DOS-1", "T", "A", "B", 100, "open", "2026-10-15"]);
      await first.close();
      const second = await openDb(dir);
      expect(await second.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM cases")).toEqual({ n: 1 });
      await second.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
