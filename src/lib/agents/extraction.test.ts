import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { AS_OF, freshEnvironment } from "@/test/helpers";
import { REAL_WORLD_CASE, REAL_WORLD_EXTRACTION } from "@/test/real-world-case";
import { FIXTURE_CASES } from "../fixtures/cases";
import { classifyDocument, inferCase } from "../intake/classify";
import { inferWithClaude, needsClaude } from "../intake/claude-infer";
import { listEntries } from "../ledger/ledger";
import { runToCompletion, startRun } from "../orchestrator/runner";
import { createCase } from "../repo/cases";
import { getSteps } from "../repo/runs";
import type { CaseDocument, EvidenceOutput, ReconciliationOutput } from "../types";
import { amountGrounded, ExtractionSchema, groundDocument, qtyGrounded, type Extraction } from "./extraction";
import { setLlmForTesting, type LlmClient, type StructuredRequest } from "./llm";

/** Fake Claude: answers the extraction call, declines everything else (agents fall back to rules). */
function fakeClaude(extraction: Extraction | null, calls: string[] = []): LlmClient {
  return {
    model: "fake-claude",
    async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
      if (req.schema === (ExtractionSchema as unknown)) {
        calls.push("extraction");
        if (!extraction) throw new Error("extraction should not have been called");
        return req.schema.parse(extraction);
      }
      if (req.system.startsWith("You are the Evidence agent")) {
        calls.push("evidence");
        return req.schema.parse({ summary: "Claude summary.", gaps: [], disputes: [] });
      }
      calls.push("other");
      throw new Error("not under test");
    },
  };
}

describe("grounding", () => {
  it("finds amounts in any common UK formatting", () => {
    expect(amountGrounded("Unit price £1,450.00", 145_000)).toBe(true);
    expect(amountGrounded("total 1450.00 GBP", 145_000)).toBe(true);
    expect(amountGrounded("£1,450 each", 145_000)).toBe(true);
    expect(amountGrounded("£1,450.00", 14_500)).toBe(false);
    expect(amountGrounded("£11,450.00", 145_000)).toBe(false);
    expect(amountGrounded("anything", -5)).toBe(false);
  });

  it("only accepts quantities printed as standalone numbers", () => {
    expect(qtyGrounded("2 x Espresso machine", 2)).toBe(true);
    expect(qtyGrounded("invoice ACE-7781", 1)).toBe(false);
    expect(qtyGrounded("£1,450.00", 1)).toBe(false);
    expect(qtyGrounded("12 units", 0)).toBe(false);
  });

  it("drops invented lines, an ungrounded total and an ungrounded payment, and explains why", () => {
    const docs: CaseDocument[] = REAL_WORLD_CASE.documents.map((d, i) => ({ ...d, id: `D${i}`, caseId: "c" }));
    const invoice = groundDocument(docs[1], REAL_WORLD_EXTRACTION.documents[1]);
    expect(invoice.invoice?.lines.map((l) => l.item)).toEqual(["Espresso machine", "Coffee grinder"]);
    expect(invoice.invoice?.totalPence).toBe(386_000);
    expect(invoice.rejected).toEqual(["“Invoice ACE-7781”: quantity 1 for Milk frother is not in the document; line ignored."]);

    const wrongTotal = groundDocument(docs[1], { ...REAL_WORLD_EXTRACTION.documents[1], totalPence: 999_900, lines: REAL_WORLD_EXTRACTION.documents[1].lines.slice(0, 2) });
    expect(wrongTotal.invoice?.totalPence).toBe(386_000); // falls back to the sum of grounded lines
    expect(wrongTotal.rejected[0]).toContain("is not in the document");

    const fakePayment = groundDocument(docs[3], { ...REAL_WORLD_EXTRACTION.documents[3], amountPaidPence: 250_000 });
    expect(fakePayment.payment).toBeUndefined();
    expect(fakePayment.rejected[0]).toContain("£2,500.00 is not in the document");
  });

  it("flags an invoice whose lines don't add up to its stated total", () => {
    const doc: CaseDocument = { id: "D", caseId: "c", kind: "invoice", title: "Inv", docDate: null, content: "Widget 2 £10.00\nTOTAL £25.00" };
    const g = groundDocument(doc, { ...REAL_WORLD_EXTRACTION.documents[1], reference: "Inv", totalPence: 2_500, lines: [{ item: "Widget", qty: 2, unitPricePence: 1_000 }] });
    expect(g.invoice?.totalPence).toBe(2_500);
    expect(g.rejected[0]).toContain("lines add up to £20.00 but the invoice states £25.00");
  });
});

describe("evidence agent with real-world documents", () => {
  beforeEach(() => {
    freshEnvironment();
  });
  afterEach(() => {
    setLlmForTesting(null);
  });

  it("reads table-layout documents with Claude and reconciles them deterministically", async () => {
    setLlmForTesting(fakeClaude(REAL_WORLD_EXTRACTION));
    createCase(REAL_WORLD_CASE, REAL_WORLD_CASE.id);
    const run = startRun(REAL_WORLD_CASE.id, "tester");
    await runToCompletion(run.id, AS_OF);
    const steps = getSteps(run.id);
    const evidence = steps[0].output as EvidenceOutput;
    const recon = steps[1].output as ReconciliationOutput;

    expect(steps[0].engine).toBe("claude");
    expect(recon.invoicedTotalPence).toBe(386_000);
    expect(recon.paidPence).toBe(100_000);
    expect(recon.shortDeliveryPence).toBe(32_000);
    expect(recon.supportedPrincipalPence).toBe(254_000); // £3,860 − £1,000 paid − 1 undelivered grinder
    expect(recon.daysOverdue).toBe(12);
    expect(evidence.gaps).toContain("“Invoice ACE-7781”: quantity 1 for Milk frother is not in the document; line ignored.");
    expect(evidence.gaps.some((g) => g.includes("no due date"))).toBe(false);

    const extracted = listEntries({ caseId: REAL_WORLD_CASE.id, limit: 200 }).filter((e) => e.action === "evidence.facts_extracted");
    expect(extracted).toHaveLength(4);
    expect(extracted.map((e) => e.description)).toContain(
      "Read “Invoice ACE-7781” with Claude: 2 lines, £3,860.00. Every figure checked against the document; 1 figure not found there were discarded.",
    );
  });

  it("never calls Claude for extraction when the rules parser already read every document", async () => {
    const calls: string[] = [];
    setLlmForTesting(fakeClaude(null, calls));
    const fixture = FIXTURE_CASES[0];
    createCase(fixture, fixture.id);
    const run = startRun(fixture.id, "tester");
    await runToCompletion(run.id, AS_OF);
    expect(calls).not.toContain("extraction");
    expect((getSteps(run.id)[2].output as { defensiblePrincipalPence: number }).defensiblePrincipalPence).toBe(1_176_500);
  });

  it("falls back to the rules engine, and says so, if Claude extraction fails", async () => {
    setLlmForTesting({ model: "broken", structured: async () => { throw new Error("overloaded"); } });
    createCase(REAL_WORLD_CASE, REAL_WORLD_CASE.id);
    const run = startRun(REAL_WORLD_CASE.id, "tester");
    await runToCompletion(run.id, AS_OF);
    expect(getSteps(run.id)[0].engine).toBe("deterministic");
    const fallback = listEntries({ caseId: REAL_WORLD_CASE.id, limit: 200 }).find((e) => e.action === "evidence.claude_fallback");
    expect(fallback?.description).toBe("Claude was unavailable, so the evidence agent used the rules engine instead.");
  });
});

describe("upload preview with Claude", () => {
  const docs = () => REAL_WORLD_CASE.documents.map((d, i) => classifyDocument(["contract.pdf", "scan-0042.pdf", "delivery.txt", "bank.txt", "email.eml"][i], d.content));

  it("asks Claude only when the rules can't infer the case", () => {
    const real = docs();
    expect(needsClaude(real, inferCase(real))).toBe(true);
  });

  it("fills in document types, parties and a grounded balance", async () => {
    const real = docs();
    expect(real[1].kind).toBe("invoice"); // still classified by keywords
    const misfiled = real.map((d, i) => (i === 3 ? { ...d, kind: "other" as const, confidence: 0.3 } : d));
    const { documents, inferred } = await inferWithClaude(fakeClaude(REAL_WORLD_EXTRACTION), misfiled, inferCase(misfiled));
    expect(documents[3]).toMatchObject({ kind: "payment", readBy: "claude" });
    expect(documents[1].readBy).toBe("rules");
    expect(inferred).toMatchObject({
      creditor: "Acme Coffee Equipment Ltd",
      debtor: "Brightside Cafés Ltd",
      debtorEmail: "sam@brightside.example",
      claimedAmountPence: 286_000, // £3,860 invoiced − £1,000 paid, both printed in the documents
      title: "Espresso machine — Brightside Cafés",
    });
    expect(inferred.summary).toContain("£2,860.00");
  });
});
