import { beforeEach, describe, expect, it } from "vitest";
import { AS_OF, flushAnchors, freshEnvironment } from "@/test/helpers";
import { getDb } from "../db";
import { runToCompletion, startRun } from "../orchestrator/runner";
import { GENESIS_HASH, canonicalJson } from "./hash";
import { appendEntry, ledgerStats, listEntries, verifyLedger } from "./ledger";
import { tamperWithCase } from "./tamper";

describe("hash utilities", () => {
  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });
});

describe("ledger", () => {
  beforeEach(async () => {
    await freshEnvironment();
  });

  it("hash-chains entries from genesis", async () => {
    const a = await appendEntry({ caseId: "c1", runId: null, actor: "agent:evidence", action: "x", payload: { n: 1 } });
    const b = await appendEntry({ caseId: "c1", runId: null, actor: "agent:evidence", action: "y", payload: { n: 2 } });
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(b.prevHash).toBe(a.entryHash);
    expect(b.seq).toBe(2);
  });

  it("anchors entries in order and verifies against the chain", async () => {
    await appendEntry({ caseId: "c1", runId: null, actor: "a", action: "x", payload: 1 });
    await appendEntry({ caseId: "c2", runId: null, actor: "a", action: "y", payload: 2 });
    await flushAnchors();
    expect(await ledgerStats()).toMatchObject({ total: 2, anchored: 2, pending: 0 });
    const report = await verifyLedger();
    expect(report.ok).toBe(true);
    expect(report.chain.onChainCount).toBe(2);
    expect(report.entries.every((e) => e.onChain === "match")).toBe(true);
    expect((await verifyLedger("c2")).checked).toBe(1);
  });

  it("rejects UPDATE and DELETE at the database level", async () => {
    await appendEntry({ caseId: "c1", runId: null, actor: "a", action: "x", payload: 1 });
    const db = await getDb();
    await expect(db.run("UPDATE ledger_entries SET action = 'evil'")).rejects.toThrow(/append-only/);
    await expect(db.run("DELETE FROM ledger_entries")).rejects.toThrow(/append-only/);
  });

  it("detects an insider rewrite even when the row's own hashes are recomputed", async () => {
    await freshEnvironment({ seed: true });
    const run = await startRun("case-harbour-kestrel", "tester");
    await runToCompletion(run.id, AS_OF);
    await flushAnchors();
    expect((await verifyLedger()).ok).toBe(true);

    const tampered = await tamperWithCase("case-harbour-kestrel");
    expect(tampered?.action).toBe("challenge.completed");
    const report = await verifyLedger();
    expect(report.ok).toBe(false);
    const hit = report.entries.find((e) => e.seq === tampered!.seq)!;
    expect(hit.onChain).toBe("mismatch");
    expect(hit.hashIntact).toBe(true); // attacker recomputed the row hash...
    const next = report.entries.find((e) => e.seq === tampered!.seq + 1)!;
    expect(next.linkIntact).toBe(false); // ...but the chain link and the on-chain anchor expose it
    // Append-only guard is restored after the simulated attack.
    await expect((await getDb()).run("DELETE FROM ledger_entries")).rejects.toThrow(/append-only/);
  });

  it("still verifies the local hash chain when the blockchain is unavailable", async () => {
    await freshEnvironment({ chain: false });
    await appendEntry({ caseId: "c1", runId: null, actor: "a", action: "x", payload: 1 });
    await flushAnchors();
    const report = await verifyLedger();
    expect(report.chain.available).toBe(false);
    expect(report.entries[0].onChain).toBe("unavailable");
    expect(report.ok).toBe(true);
    expect((await listEntries())[0].anchor.status).toBe("pending");
  });
});

describe("ledger resilience", () => {
  it("detects a truncated log via on-chain anchors", async () => {
    await freshEnvironment();
    await appendEntry({ caseId: "c1", runId: null, actor: "a", action: "x", payload: 1 });
    await appendEntry({ caseId: "c1", runId: null, actor: "a", action: "y", payload: 2 });
    await flushAnchors();
    const db = await getDb();
    // Disable (not drop) the guard so the shared per-file database keeps it for later tests.
    await db.exec("ALTER TABLE ledger_entries DISABLE TRIGGER ledger_no_delete");
    await db.run("DELETE FROM ledger_anchors WHERE seq = 2");
    await db.run("DELETE FROM ledger_entries WHERE seq = 2");
    await db.exec("ALTER TABLE ledger_entries ENABLE TRIGGER ledger_no_delete");
    const report = await verifyLedger();
    expect(report.ok).toBe(false);
    expect(report.missingFromDb).toBe(1);
  });

  it("re-anchors entries when the chain is reset (e.g. local node restarted)", async () => {
    await freshEnvironment();
    await appendEntry({ caseId: "c1", runId: null, actor: "a", action: "x", payload: 1 });
    await flushAnchors();
    const { MemoryAnchor } = await import("./anchor");
    const { setAnchorForTesting } = await import("./anchor-registry");
    setAnchorForTesting(new MemoryAnchor()); // same "address", empty log
    await appendEntry({ caseId: "c1", runId: null, actor: "a", action: "y", payload: 2 });
    await flushAnchors();
    expect(await ledgerStats()).toMatchObject({ total: 2, anchored: 2, errored: 0 });
    expect((await verifyLedger()).ok).toBe(true);
  });
});
