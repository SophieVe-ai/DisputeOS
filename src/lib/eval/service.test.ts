import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushAnchors, freshEnvironment } from "@/test/helpers";
import { listEntries } from "../ledger/ledger";

const execFile = vi.fn();
vi.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => execFile(...args) }));

const REPORT = { score: 97.5, optimisation: 100, efficiency: 91.7, engine: "deterministic", startedAt: "2026-10-15T10:00:00.000Z", checksPassed: 38, checksTotal: 38, scenarios: [{ id: "x", score: 97.5 }] };

describe("eval service", () => {
  let cwd: string;
  beforeEach(() => {
    freshEnvironment();
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "disputeos-eval-"));
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    execFile.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("records the report, persists history and anchors the score on the ledger", async () => {
    execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null, JSON.stringify(REPORT), ""));
    const { getEvalState, startEval } = await import("./service");
    const record = await startEval("tester");
    await flushAnchors();
    expect(record.report.score).toBe(97.5);
    const entry = listEntries({ limit: 10 }).find((e) => e.action === "eval.completed")!;
    expect(entry).toMatchObject({ seq: record.ledgerSeq, actor: "system:evaluator", anchor: { status: "anchored" } });
    expect(getEvalState()).toMatchObject({ running: false, error: null, latest: { ledgerSeq: record.ledgerSeq }, history: [{ score: 97.5 }] });
  });

  it("coalesces concurrent runs and surfaces failures", async () => {
    execFile.mockImplementation((_cmd, _args, _opts, cb) => setTimeout(() => cb(new Error("boom"), "", "tsx: crashed"), 5));
    const { getEvalState, startEval } = await import("./service");
    const a = startEval("tester");
    const b = startEval("tester");
    expect(getEvalState().running).toBe(true);
    await expect(a).rejects.toThrow("Eval process failed: tsx: crashed");
    await expect(b).rejects.toThrow();
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(getEvalState()).toMatchObject({ running: false, error: "Eval process failed: tsx: crashed", latest: null });
  });
});
