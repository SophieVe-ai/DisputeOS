import { appendEntry } from "./ledger/ledger";
import { countCases, createCase } from "./repo/cases";
import { DEMO_CASES } from "./seed-data";

export function seedDemoData(): number {
  for (const demo of DEMO_CASES) {
    const created = createCase(demo, demo.id);
    appendEntry({
      caseId: created.id,
      runId: null,
      actor: "system:intake",
      action: "case.opened",
      payload: { reference: created.reference, claimedAmountPence: created.claimedAmountPence, documents: demo.documents.length },
    });
  }
  return DEMO_CASES.length;
}

/** Seeds demo cases on first boot so `npm run dev` always has something to show. */
export function ensureSeeded(): void {
  if (countCases() === 0) seedDemoData();
}
