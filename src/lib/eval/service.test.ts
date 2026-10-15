import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushAnchors, freshEnvironment } from "@/test/helpers";
import { listEntries } from "../ledger/ledger";

const runEval = vi.fn();
vi.mock("./harness", () => ({ runEval: (...args: unknown[]) => runEval(...args) }));

const REPORT = { score: 97.5, optimisation: 100, efficiency: 91.7, engine: "deterministic", startedAt: "2026-10-15T10:00:00.000Z", checksPassed: 38, checksTotal: 38, scenarios: [{ id: "x", score: 97.5 }] };

describe("eval service", () => {
  beforeEach(async () => {
    await freshEnvironment();
    runEval.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records the report, persists history and anchors the score on the ledger", async () => {
    runEval.mockResolvedValue(REPORT);
    const { getEvalState, startEval } = await import("./service");
    const record = await startEval("tester");
    await flushAnchors();
    expect(record.report.score).toBe(97.5);
    const entry = (await listEntries({ limit: 10 })).find((e) => e.action === "eval.completed")!;
    expect(entry).toMatchObject({ seq: record.ledgerSeq, actor: "system:evaluator", anchor: { status: "anchored" } });
    expect(await getEvalState()).toMatchObject({ running: false, error: null, latest: { ledgerSeq: record.ledgerSeq }, history: [{ score: 97.5 }] });
  });

  it("coalesces concurrent runs and surfaces failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let started!: () => void;
    const hasStarted = new Promise<void>((resolve) => (started = resolve));
    let fail!: (err: Error) => void;
    runEval.mockImplementation(() => {
      started();
      return new Promise((_resolve, reject) => (fail = reject));
    });
    const { getEvalState, startEval } = await import("./service");
    const a = startEval("tester");
    const b = startEval("tester");
    await hasStarted;
    expect((await getEvalState()).running).toBe(true);
    fail(new Error("eval crashed"));
    await expect(a).rejects.toThrow("eval crashed");
    await expect(b).rejects.toThrow();
    expect(runEval).toHaveBeenCalledTimes(1);
    expect(await getEvalState()).toMatchObject({ running: false, error: "eval crashed", latest: null });
  });
});
