import { openDb, setDb } from "@/lib/db";
import { MemoryAnchor } from "@/lib/ledger/anchor";
import { setAnchorForTesting } from "@/lib/ledger/anchor-registry";
import { syncAnchors } from "@/lib/ledger/ledger";
import { FIXTURE_CASES } from "@/lib/fixtures/cases";
import { appendEntry } from "@/lib/ledger/ledger";
import { createCase } from "@/lib/repo/cases";

export const AS_OF = "2026-10-15";

export function freshEnvironment(opts: { seed?: boolean; chain?: boolean } = {}): MemoryAnchor | null {
  setDb(openDb(":memory:"));
  const anchor = opts.chain === false ? null : new MemoryAnchor();
  setAnchorForTesting(anchor);
  if (opts.seed) seedFixtures();
  return anchor;
}

export async function flushAnchors(): Promise<void> {
  await syncAnchors();
  await syncAnchors();
}

/** Loads the fixture cases the same way the intake API would. Test-only: the app never seeds. */
export function seedFixtures(): number {
  for (const fixture of FIXTURE_CASES) {
    const created = createCase(fixture, fixture.id);
    appendEntry({
      caseId: created.id,
      runId: null,
      actor: "system:intake",
      action: "case.opened",
      payload: { reference: created.reference, claimedAmountPence: created.claimedAmountPence, documents: fixture.documents.length },
    });
  }
  return FIXTURE_CASES.length;
}
