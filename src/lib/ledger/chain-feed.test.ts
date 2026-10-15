import { beforeEach, describe, expect, it } from "vitest";
import { AS_OF, flushAnchors, freshEnvironment } from "@/test/helpers";
import { runToCompletion, startRun } from "../orchestrator/runner";
import { caseKey, ENTRY_ANCHORED_TOPIC } from "./anchor";
import { chainFeed } from "./chain-feed";
import { appendEntry } from "./ledger";
import { tamperWithCase } from "./tamper";

describe("chain feed", () => {
  beforeEach(() => {
    freshEnvironment();
  });

  it("returns entries oldest-first, joined to confirmed on-chain anchors", async () => {
    appendEntry({ caseId: "c1", runId: null, actor: "agent:evidence", action: "a", payload: 1 });
    appendEntry({ caseId: "c1", runId: null, actor: "agent:evidence", action: "b", payload: 2 });
    await flushAnchors();
    const feed = await chainFeed({ caseId: "c1" });
    expect(feed.entries.map((e) => e.action)).toEqual(["a", "b"]);
    expect(feed.entries.every((e) => e.anchorStatus === "anchored" && e.hashMatches === true)).toBe(true);
    expect(feed.chain).toMatchObject({ connected: true, latestBlock: 2 });
  });

  it("joins each entry to the EntryAnchored log the contract emitted for it", async () => {
    appendEntry({ caseId: "c1", runId: null, actor: "agent:evidence", action: "a", payload: 1 });
    appendEntry({ caseId: "c2", runId: null, actor: "agent:challenge", action: "b", payload: 2 });
    await flushAnchors();
    const [entry] = (await chainFeed({ caseId: "c2" })).entries;
    expect(entry.seq).toBe(2);
    expect(entry.event).toMatchObject({ index: 1, actor: "agent:challenge", action: "b", caseKey: caseKey("c2") });
    expect(entry.event?.topics[0]).toBe(ENTRY_ANCHORED_TOPIC);
    expect(entry.event?.entryHash).toBe(entry.entryHash);
  });

  it("flags an entry whose database hash no longer matches its on-chain anchor", async () => {
    freshEnvironment({ seed: true });
    const run = startRun("case-harbour-kestrel", "tester");
    await runToCompletion(run.id, AS_OF);
    await flushAnchors();
    const tampered = tamperWithCase("case-harbour-kestrel")!;
    const feed = await chainFeed({ caseId: "case-harbour-kestrel", limit: 300 });
    const hit = feed.entries.find((e) => e.seq === tampered.seq)!;
    expect(hit.hashMatches).toBe(false);
    expect(feed.entries.filter((e) => e.hashMatches === false)).toHaveLength(1);
  });

  it("still lists entries as pending when the chain is unavailable", async () => {
    freshEnvironment({ chain: false });
    appendEntry({ caseId: null, runId: null, actor: "system", action: "boot", payload: null });
    const feed = await chainFeed();
    expect(feed.chain.connected).toBe(false);
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]).toMatchObject({ anchorStatus: "pending", event: null, hashMatches: null });
  });
});
