import { describe, expect, it } from "vitest";
import { detectDisputes, extractFacts, parseInvoice, parseLines } from "./parser";
import { DEMO_CASES } from "./seed-data";
import type { CaseDocument } from "./types";

const docsFor = (i: number): CaseDocument[] =>
  DEMO_CASES[i].documents.map((d, n) => ({ ...d, id: `D${n + 1}`, caseId: DEMO_CASES[i].id }));

describe("parser", () => {
  it("parses priced and quantity lines", () => {
    const { priced, qty } = parseLines("- Widget | qty 3 | £1,000.50\n- Gadget | qty 2\nnoise");
    expect(priced).toEqual([{ item: "Widget", qty: 3, unitPricePence: 100_050 }]);
    expect(qty).toHaveLength(2);
  });

  it("parses invoices, falling back to computed totals", () => {
    const inv = parseInvoice({ id: "x", caseId: "c", kind: "invoice", title: "Inv", docDate: "2026-01-01", content: "- A | qty 2 | £10.00" });
    expect(inv.totalPence).toBe(2_000);
    expect(inv.number).toBe("Inv");
    expect(inv.date).toBe("2026-01-01");
  });

  it("extracts the Harbour Joinery case facts", () => {
    const facts = extractFacts(docsFor(0), DEMO_CASES[0]);
    expect(facts.contract?.paymentTermsDays).toBe(30);
    expect(facts.contract?.inspectionDays).toBe(5);
    expect(facts.invoices[0].totalPence).toBe(1_792_000);
    expect(facts.payments[0].amountPence).toBe(500_000);
    expect(facts.deliveries[0].signedBy).toContain("R. Patel");
    const damage = facts.disputes.find((d) => d.type === "damage");
    expect(damage).toMatchObject({ qty: 3, item: "Shaker oak kitchen unit", date: "2026-06-06" });
    expect(facts.disputes.some((d) => d.type === "quality")).toBe(true);
  });

  it("ignores creditor-authored chasers", () => {
    const chaser: CaseDocument = { id: "m", caseId: "c", kind: "correspondence", title: "chaser", docDate: null, content: "From: Megan (Harbour Joinery)\nThe goods were damaged? No — please pay." };
    expect(detectDisputes(chaser, DEMO_CASES[0], [])).toEqual([]);
  });

  it("detects pricing and shortfall disputes with quantities", () => {
    const facts = extractFacts(docsFor(2), DEMO_CASES[2]);
    expect(facts.disputes.map((d) => d.type).sort()).toEqual(["pricing", "shortfall"]);
    expect(facts.disputes.find((d) => d.type === "shortfall")?.qty).toBe(4);
  });
});
