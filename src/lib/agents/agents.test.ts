import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { FIXTURE_CASES as DEMO_CASES } from "../fixtures/cases";
import type { CaseDocument, ChallengeOutput, DisputeCase, EvidenceOutput, ReconciliationOutput } from "../types";
import { challengeAgent } from "./challenge";
import type { AgentContext } from "./context";
import { evidenceAgent } from "./evidence";
import type { LlmClient, StructuredRequest } from "./llm";
import { reconciliationAgent } from "./reconciliation";
import { resolutionAgent } from "./resolution";

const AS_OF = "2026-10-15";

function fakeLlm(responder: (system: string) => unknown): LlmClient {
  return {
    model: "fake",
    async structured<S extends z.ZodType>(req: StructuredRequest<S>) {
      return req.schema.parse(responder(req.system));
    },
  };
}

function makeCtx(caseIndex: number, opts: { llm?: LlmClient | null; docs?: CaseDocument[]; prior?: AgentContext["prior"]; asOf?: string } = {}) {
  const demo = DEMO_CASES[caseIndex];
  const caseFile: DisputeCase = { ...demo, id: demo.id, reference: demo.reference!, status: "in_review", createdAt: AS_OF };
  const docs = opts.docs ?? demo.documents.map((d, i) => ({ ...d, id: `D${i + 1}`, caseId: demo.id }));
  const logs: { action: string; payload: unknown }[] = [];
  const ctx: AgentContext = {
    caseFile,
    documents: docs,
    asOf: opts.asOf ?? AS_OF,
    baseRatePercent: 4,
    prior: opts.prior ?? {},
    llm: opts.llm ?? null,
    log: (action, payload) => logs.push({ action, payload }),
    pace: async () => undefined,
  };
  return { ctx, logs };
}

async function pipeline(caseIndex: number, llm: LlmClient | null = null, docs?: CaseDocument[], asOf?: string) {
  const evidence = (await evidenceAgent.run(makeCtx(caseIndex, { llm, docs, asOf }).ctx)).output as EvidenceOutput;
  const reconciliation = (await reconciliationAgent.run(makeCtx(caseIndex, { docs, prior: { evidence }, asOf }).ctx)).output as ReconciliationOutput;
  const challenge = (await challengeAgent.run(makeCtx(caseIndex, { llm, docs, prior: { evidence, reconciliation }, asOf }).ctx)).output as ChallengeOutput;
  const resolution = await resolutionAgent.run(makeCtx(caseIndex, { llm, docs, prior: { evidence, reconciliation, challenge }, asOf }).ctx);
  return { evidence, reconciliation, challenge, resolution };
}

describe("Claude-enhanced agents", () => {
  it("merges Claude findings while keeping deterministic numbers", async () => {
    const llm = fakeLlm((system) => {
      if (system.includes("Evidence agent")) {
        return { summary: "Claude summary", gaps: ["Photos of damage not on file"], disputes: [{ docId: "D7", date: "2026-08-20", type: "other", item: null, qty: null, claim: "withholding" }, { docId: "NOPE", date: null, type: "damage", item: null, qty: 99, claim: "x" }] };
      }
      if (system.includes("Challenge agent")) {
        return { additional: [{ title: "Retention of title clause missing", argument: "a", severity: "low", basisDocId: "BAD", verdict: "partially_upheld", rebuttal: "r", impactPence: 0 }] };
      }
      return { strategy: "Claude strategy", letterBeforeAction: "Pay £12,259.53 now please." };
    });
    const { evidence, challenge, resolution } = await pipeline(0, llm);
    expect(evidence.summary).toBe("Claude summary");
    expect(evidence.gaps).toContain("Photos of damage not on file");
    expect(evidence.facts.disputes.some((d) => d.docId === "NOPE")).toBe(false);
    const ai = challenge.challenges.find((c) => c.source === "claude");
    expect(ai).toMatchObject({ id: "AI1", basisDocId: null });
    expect(challenge.defensiblePrincipalPence).toBe(1_176_500);
    expect(resolution.engine).toBe("claude");
    expect(resolution.output.strategy).toBe("Claude strategy");
    expect(resolution.output.proposals[0].documentBody).toBe("Pay £12,259.53 now please.");
  });

  it("falls back to deterministic output when Claude fails or loses the figures", async () => {
    const llm = fakeLlm((system) => {
      if (system.includes("Resolution agent")) return { strategy: "s", letterBeforeAction: "Pay whatever you like." };
      throw new Error("API down");
    });
    const evCtx = makeCtx(0, { llm });
    const ev = await evidenceAgent.run(evCtx.ctx);
    expect(ev.engine).toBe("deterministic");
    expect(evCtx.logs.map((l) => l.action)).toContain("evidence.claude_fallback");
    const { resolution } = await pipeline(0, llm);
    expect(resolution.engine).toBe("deterministic");
    expect(resolution.output.proposals[0].documentBody).toContain("Letter Before Action");
  });
});

describe("challenge edge cases", () => {
  const invoiceOnly = (date: string): CaseDocument[] => [
    { id: "I1", caseId: "c", kind: "invoice", title: "Invoice X-1", docDate: date, content: `Invoice number: X-1\nInvoice date: ${date}\n- Widget | qty 10 | £100.00\nTotal due: £1,000.00` },
    { id: "E1", caseId: "c", kind: "correspondence", title: "Debtor email", docDate: date, content: "From: Someone (Kestrel Developments)\nDate: 2026-09-01\nWe never received the widgets." },
  ];

  it("flags missing contract, missing proof of delivery and non-receipt", async () => {
    const { evidence, challenge, reconciliation } = await pipeline(0, null, invoiceOnly("2026-06-01"));
    expect(evidence.gaps.join(" ")).toMatch(/No signed contract/);
    expect(reconciliation.lines[0].flags).toContain("No delivery record to confirm quantity");
    const titles = challenge.challenges.map((c) => c.title);
    expect(titles).toEqual(expect.arrayContaining(["No signed contract on file", "No proof of delivery", "Debtor claims goods never arrived", "No prior written demand"]));
    expect(challenge.defensiblePrincipalPence).toBe(0);
    expect(challenge.recommendation).toBe("write_off");
  });

  it("writes off statute-barred debts", async () => {
    const { challenge, resolution } = await pipeline(0, null, invoiceOnly("2019-01-01"));
    expect(challenge.challenges.some((c) => c.title === "Claim may be statute-barred")).toBe(true);
    expect(resolution.output.proposals.map((p) => p.kind)).toEqual(["write_off"]);
    expect(resolution.output.proposals[0].documentBody).toContain("Write-off");
  });

  it("discounts damage by half when there is no inspection clause", async () => {
    const docs: CaseDocument[] = [
      { id: "K", caseId: "c", kind: "contract", title: "Contract", docDate: null, content: "Payment terms: 30 days\n- Widget | qty 10 | £100.00" },
      { id: "I", caseId: "c", kind: "invoice", title: "Inv", docDate: null, content: "Invoice number: 9\nInvoice date: 2026-06-01\n- Widget | qty 10 | £100.00" },
      { id: "N", caseId: "c", kind: "delivery_note", title: "DN", docDate: null, content: "Delivery date: 2026-06-01\n- Widget | qty 10" },
      { id: "E", caseId: "c", kind: "correspondence", title: "Email", docDate: null, content: "From: Buyer (Kestrel)\nDate: 2026-06-02\n2 widgets were damaged in transit. Also the finish is poor quality." },
    ];
    const { challenge, evidence } = await pipeline(0, null, docs);
    expect(evidence.gaps.join(" ")).toMatch(/unsigned/);
    const damage = challenge.challenges.find((c) => c.title.includes("damaged"));
    expect(damage).toMatchObject({ verdict: "partially_upheld", impactPence: 10_000 });
    expect(challenge.challenges.some((c) => c.title === "Unsigned delivery note")).toBe(true);
  });
});

describe("multi-invoice interest", () => {
  it("charges interest per invoice from its own due date and compensation on the debt owed", async () => {
    const { allocateDebt, interestSchedule } = await import("./reconciliation");
    const facts = {
      contract: null,
      invoices: [
        { docId: "a", number: "1", date: null, dueDate: "2026-01-01", lines: [], totalPence: 105_000 },
        { docId: "b", number: "2", date: null, dueDate: "2026-09-15", lines: [], totalPence: 50_000 },
      ],
      deliveries: [],
      payments: [{ docId: "p", date: null, amountPence: 105_000, reference: null }],
      disputes: [],
    };
    const tranches = allocateDebt(facts, 50_000);
    expect(tranches).toEqual([{ dueDate: "2026-01-01", principalPence: 0 }, { dueDate: "2026-09-15", principalPence: 50_000 }]);
    const { interestPence, compensationPence } = interestSchedule(facts, 50_000, "2026-10-15", 4);
    expect(interestPence).toBe(Math.round((50_000 * 0.12 * 30) / 365));
    expect(compensationPence).toBe(4_000); // £500 debt → £40 band, not the gross £1,050 invoice
  });

  it("reconciles the same item invoiced at two prices separately", async () => {
    const { reconcileLines } = await import("./reconciliation");
    const lines = reconcileLines({
      contract: { docId: "k", reference: null, date: null, paymentTermsDays: 30, inspectionDays: null, lines: [{ item: "Bolt", qty: 20, unitPricePence: 100 }] },
      invoices: [{ docId: "i", number: "1", date: null, dueDate: null, totalPence: 0, lines: [{ item: "Bolt", qty: 10, unitPricePence: 100 }, { item: "Bolt", qty: 10, unitPricePence: 150 }] }],
      deliveries: [{ docId: "d", date: null, signedBy: "x", lines: [{ item: "Bolt", qty: 20 }] }],
      payments: [],
      disputes: [],
    });
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.variancePence)).toEqual([0, 500]);
    expect(lines.every((l) => l.supportedPence === 1_000)).toBe(true);
  });
});
