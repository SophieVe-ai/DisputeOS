import { ensureSeeded } from "./seed";
import { startWorker } from "./orchestrator/worker";

const g = globalThis as unknown as { __disputeosBooted?: boolean };

/** Idempotent app bootstrap: seed demo data on first run and start the agent worker. */
export function boot(): void {
  if (g.__disputeosBooted) return;
  g.__disputeosBooted = true;
  ensureSeeded();
  startWorker();
}
