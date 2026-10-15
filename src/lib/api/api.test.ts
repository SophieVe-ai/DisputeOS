import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AS_OF, freshEnvironment } from "@/test/helpers";
import { setAnchorForTesting, getAnchor, anchorError, resetAnchor } from "../ledger/anchor-registry";
import { ApprovalRequiredError, DecisionError, ForbiddenError } from "../orchestrator/approvals";
import { RunConflictError, runToCompletion, startRun } from "../orchestrator/runner";
import { fail, handle, ok, readJson } from "./http";
import { DecisionSchema, NewCaseSchema } from "./schemas";
import { caseDetail, caseSummaries, systemStatus } from "./views";

describe("http helpers", () => {
  beforeEach(() => {
    freshEnvironment({ seed: true });
  });

  it("wraps results in the API envelope", async () => {
    expect(await ok({ a: 1 }).json()).toEqual({ success: true, data: { a: 1 }, error: null });
    expect((await fail("nope", 404)).status).toBe(404);
  });

  it.each([
    [new ForbiddenError("x"), 403],
    [new RunConflictError("x"), 409],
    [new DecisionError("x"), 409],
    [new ApprovalRequiredError("x"), 412],
    [new Error("secret internals"), 500],
  ])("maps %s to HTTP %i without leaking details", async (err, status) => {
    const res = await handle(() => {
      throw err;
    });
    expect(res.status).toBe(status);
    if (status === 500) expect((await res.json()).error).toBe("Internal server error");
  });

  it("maps validation errors to 400", async () => {
    const res = await handle(() => ok(NewCaseSchema.parse({})));
    expect(res.status).toBe(400);
    expect(() => DecisionSchema.parse({ decision: "approve", approver: "<script>" })).toThrow(ZodError);
  });

  it("tolerates malformed JSON bodies", async () => {
    expect(await readJson(new Request("http://x", { method: "POST", body: "{bad" }))).toEqual({});
  });
});

describe("read models", () => {
  beforeEach(() => {
    freshEnvironment({ seed: true });
  });

  it("summarises cases and system status", async () => {
    const run = startRun("case-northbank-lumen", "tester");
    await runToCompletion(run.id, AS_OF);
    const lumen = caseSummaries().find((c) => c.id === "case-northbank-lumen")!;
    expect(lumen.defensiblePrincipalPence).toBe(675_000);
    expect(caseDetail("case-northbank-lumen")?.proposals).toHaveLength(2);
    expect(caseDetail("missing")).toBeNull();
    const status = await systemStatus();
    expect(status.stats.cases).toBe(3);
    expect(status.stats.awaitingApproval).toBe(2);
    expect(status.engine.mode).toBe("deterministic");
    expect(status.chain.connected).toBe(true);
  });

  it("reports the chain as offline when no anchor is available", async () => {
    setAnchorForTesting(null);
    expect(await getAnchor()).toBeNull();
    expect(anchorError()).toBe("disabled");
    resetAnchor("ignored while overridden");
    expect((await systemStatus()).chain.connected).toBe(false);
  });
});
