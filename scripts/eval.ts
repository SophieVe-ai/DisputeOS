// Agent eval CLI.  `npm run eval`            → human-readable report
//                  `npm run eval -- --json`  → machine-readable report (used by /api/evals)
//                  `npm run eval -- --min 90` → exit 1 if the overall score is below 90%
process.env.DEMO_STEP_DELAY_MS = "0";
process.env.DISABLE_WORKER = "1";

const args = process.argv.slice(2);
const json = args.includes("--json");
const minIndex = args.indexOf("--min");
const min = minIndex >= 0 ? Number(args[minIndex + 1]) : null;

async function main() {
  const { runEval } = await import("../src/lib/eval/harness");
  const report = await runEval({
    onProgress: json ? undefined : (s) => console.log(`  ${s.status === "completed" ? "✓" : "✕"} ${s.name.padEnd(42)} ${s.score.toFixed(1).padStart(5)}%  (opt ${s.optimisation}%, eff ${s.efficiency}%, ${s.durationMs} ms)${s.error ? `  ${s.error}` : ""}`),
  });
  if (json) {
    process.stdout.write(JSON.stringify(report));
  } else {
    for (const s of report.scenarios) {
      for (const c of s.checks.filter((c) => c.score < 1)) console.log(`    ✕ ${s.id} · ${c.name}: expected ${c.expected}, got ${c.actual}`);
      for (const m of s.metrics.filter((m) => m.score < 1)) console.log(`    ~ ${s.id} · ${m.name}: ${m.value} (budget ${m.budget}) → ${(m.score * 100).toFixed(0)}%`);
    }
    console.log(`\nAgent eval (${report.engine}${report.model ? ` · ${report.model}` : ""})`);
    console.log(`  Optimisation ${report.optimisation}%  ·  Efficiency ${report.efficiency}%  ·  Checks ${report.checksPassed}/${report.checksTotal}`);
    console.log(`  OVERALL ${report.score}%\n`);
  }
  if (min !== null && report.score < min) {
    console.error(`Eval score ${report.score}% is below the required ${min}%`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
