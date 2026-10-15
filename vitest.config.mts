import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Each test file boots an embedded Postgres (PGlite, WebAssembly); with files running in
    // parallel on a busy machine the first boot can take several seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { DISABLE_WORKER: "1", DEMO_STEP_DELAY_MS: "0", DISPUTEOS_ENGINE: "deterministic", BOE_BASE_RATE: "4" },
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/fixtures/**", "src/lib/agents/llm.ts", "src/lib/ledger/anchor.ts", "src/lib/orchestrator/worker.ts"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
