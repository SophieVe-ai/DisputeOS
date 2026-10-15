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
  beforeEach(() => {
    freshEnvironment();
  });

  it("hash-chains entries from genesis", () => {
    const a = appendEntry({ caseId: "c1", runId: null, actor: "agent:evidence", action: "x", payload: { n: 1 } });
    const b = appendEntry({ caseId: "c1", runId: null, actor: "agent:evidence", action: "y", payload: { n: 2 } });
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(b.prevHash).toBe(a.entryHash);
    expect(b.seq).toBe(2);
  });

  it("anchors entries in order and verifies against the chain", async () => {
    appendEntry({ caseId: "c1", runId: null, actor: "a", action: "x", payload: 1 });
    appendEntry({ caseId: "c2", runId: null, actor: "a", action: "y", payload: 2 });
    await flushAnchors();
    expect(ledgerStats()).toMatchObject({ total: 2, anchored: 2, pending: 0 });
    const report = await verifyLedger();
    expect(report.ok).toBe(true);
    expect(report.chain.onChainCount).toBe(2);
    expect(report.entries.every((e) => e.onChain === "match")).toBe(true);
    expect((await verifyLedger("c2")).checked).toBe(1);
  });

  it("rejects UPDATE and DELETE at the database level", () => {
    appendEntry({ caseId: "c1", runId: null, actor: "a", action: "x", payload: 1 });
    expect(() => getDb().prepare("UPDATE ledger_entries SET action = 'evil'").run()).toThrow(/append-only/);
    expect(() => getDb().prepare("DELETE FROM ledger_entries").run()).toThrow(/append-only/);
  });

  it("detects an insider rewrite even when the row's own hashes are recomputed", async () => {
    freshEnvironment({ seed: true });
    const run = startRun("case-harbour-kestrel", "tester");
    await runToCompletion(run.id, AS_OF);
    await flushAnchors();
    expect((await verifyLedger()).ok).toBe(true);

    const tampered = tamperWithCase("case-harbour-kestrel");
    expect(tampered?.action).toBe("challenge.completed");
    const report = await verifyLedger();
    expect(report.ok).toBe(false);
    const hit = report.entries.find((e) => e.seq === tampered!.seq)!;
    expect(hit.onChain).toBe("mismatch");
    expect(hit.hashIntact).toBe(true); // attacker recomputed the row hash...
    const next = report.entries.find((e) => e.seq === tampered!.seq + 1)!;
    expect(next.linkIntact).toBe(false); // ...but the chain link and the on-chain anchor expose it
    // Append-only guard is restored after the simulated attack.
    expect(() => getDb().prepare("DELETE FROM ledger_entries").run()).toThrow(/append-only/);
  });

  it("still verifies the local hash chain when the blockchain is unavailable", async () => {
    freshEnvironment({ chain: false });
    appendEntry({ caseId: "c1", runId: null, actor: "a", action: "x", payload: 1 });
    await flushAnchors();
    const report = await verifyLedger();
    expect(report.chain.available).toBe(false);
    expect(report.entries[0].onChain).toBe("unavailable");
    expect(report.ok).toBe(true);
    expect(listEntries()[0].anchor.status).toBe("pending");
  });
});

describe("ledger resilience", () => {
  it("detects a truncated log via on-chain anchors", async () => {
    freshEnvironment();
    appendEntry({ caseId: "c1", runId: null, actor: "a", action: "x", payload: 1 });
    appendEntry({ caseId: "c1", runId: null, actor: "a", action: "y", payload: 2 });
    await flushAnchors();
    getDb().exec("DROP TRIGGER ledger_no_delete");
    getDb().prepare("DELETE FROM ledger_anchors WHERE seq = 2").run();
    getDb().prepare("DELETE FROM ledger_entries WHERE seq = 2").run();
    const report = await verifyLedger();
    expect(report.ok).toBe(false);
    expect(report.missingFromDb).toBe(1);
  });

  it("re-anchors entries when the chain is reset (e.g. local node restarted)", async () => {
    freshEnvironment();
    appendEntry({ caseId: "c1", runId: null, actor: "a", action: "x", payload: 1 });
    await flushAnchors();
    const { MemoryAnchor } = await import("./anchor");
    const { setAnchorForTesting } = await import("./anchor-registry");
    setAnchorForTesting(new MemoryAnchor()); // same "address", empty log
    appendEntry({ caseId: "c1", runId: null, actor: "a", action: "y", payload: 2 });
    await flushAnchors();
    expect(ledgerStats()).toMatchObject({ total: 2, anchored: 2, errored: 0 });
    expect((await verifyLedger()).ok).toBe(true);
  });
});
