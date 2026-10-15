import { describe, expect, it } from "vitest";
import { amountAccuracy, runEval, sequenceSimilarity } from "./harness";
import { SCENARIOS } from "./scenarios";

describe("scoring primitives", () => {
  it("amountAccuracy is exact at 1 and decays linearly", () => {
    expect(amountAccuracy(100, 100)).toBe(1);
    expect(amountAccuracy(150, 100)).toBe(0.5);
    expect(amountAccuracy(0, 0)).toBe(1);
    expect(amountAccuracy(5, 0)).toBe(0);
    expect(amountAccuracy(500, 100)).toBe(0);
  });

  it("sequenceSimilarity rewards the right actions in the right order", () => {
    expect(sequenceSimilarity(["a", "b"], ["a", "b"])).toBe(1);
    expect(sequenceSimilarity(["b", "a"], ["a", "b"])).toBeCloseTo(0.85);
    expect(sequenceSimilarity(["a"], ["a", "b"])).toBeCloseTo(0.425);
    expect(sequenceSimilarity([], [])).toBe(1);
  });
});

describe("agent eval", () => {
  it("scores every gold scenario and reports a percentage", async () => {
    const report = await runEval();
    for (const s of report.scenarios) {
      const misses = s.checks.filter((c) => c.score < 1).map((c) => `${c.name}: expected ${c.expected}, got ${c.actual}`);
      expect({ id: s.id, status: s.status, error: s.error, misses }).toEqual({ id: s.id, status: "completed", error: null, misses: [] });
    }
    expect(report.total).toBe(SCENARIOS.length);
    expect(report.optimisation).toBe(100);
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.engine).toBe("deterministic");
  }, 60_000);

  it("penalises a wrong answer", async () => {
    const wrong = { ...SCENARIOS[1], expected: { ...SCENARIOS[1].expected, defensiblePrincipalPence: 337_500, recommendation: "negotiate" as const } };
    const report = await runEval({ scenarios: [wrong] });
    const s = report.scenarios[0];
    expect(s.checks.find((c) => c.name === "Defensible principal")?.score).toBe(0);
    expect(s.checks.find((c) => c.name === "Recommendation")?.score).toBe(0);
    expect(s.optimisation).toBeLessThan(80);
  }, 30_000);

  it("reports a failing scenario instead of throwing", async () => {
    const broken = { ...SCENARIOS[0], load: async () => { throw new Error("corrupt upload"); } };
    const report = await runEval({ scenarios: [broken] });
    expect(report.scenarios[0]).toMatchObject({ status: "failed", error: "corrupt upload", score: 0 });
  }, 30_000);
});
