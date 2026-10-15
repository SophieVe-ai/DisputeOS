import { afterAll } from "vitest";
import { openDb, setDb, TABLES, type Db } from "@/lib/db";
import { MemoryAnchor } from "@/lib/ledger/anchor";
import { setAnchorForTesting } from "@/lib/ledger/anchor-registry";
import { appendEntry, syncAnchors } from "@/lib/ledger/ledger";
import { FIXTURE_CASES } from "@/lib/fixtures/cases";
import { createCase } from "@/lib/repo/cases";

export const AS_OF = "2026-10-15";

// One embedded Postgres per test file, emptied between tests (opening one per test is slow).
let shared: Promise<Db> | null = null;
afterAll(async () => {
  if (shared) await (await shared).close();
  shared = null;
});

export async function testDb(): Promise<Db> {
  shared ??= openDb("memory://");
  return shared;
}

export async function freshEnvironment(opts: { seed?: boolean; chain?: boolean } = {}): Promise<MemoryAnchor | null> {
  const db = await testDb();
  await db.exec(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  setDb(db);
  const anchor = opts.chain === false ? null : new MemoryAnchor();
  setAnchorForTesting(anchor);
  if (opts.seed) await seedFixtures();
  return anchor;
}

export async function flushAnchors(): Promise<void> {
  await syncAnchors();
  await syncAnchors();
}

/** Loads the fixture cases the same way the intake API would. Test-only: the app never seeds. */
export async function seedFixtures(): Promise<number> {
  for (const fixture of FIXTURE_CASES) {
    const created = await createCase(fixture, fixture.id);
    await appendEntry({
      caseId: created.id,
      runId: null,
      actor: "system:intake",
      action: "case.opened",
      payload: { reference: created.reference, claimedAmountPence: created.claimedAmountPence, documents: fixture.documents.length },
    });
  }
  return FIXTURE_CASES.length;
}
