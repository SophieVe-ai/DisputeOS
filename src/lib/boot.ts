import { startWorker } from "./orchestrator/worker";

const g = globalThis as unknown as { __disputeosBooted?: boolean };

/** Idempotent app bootstrap: start the agent worker. Cases only ever come from users. */
export function boot(): void {
  if (g.__disputeosBooted) return;
  g.__disputeosBooted = true;
  startWorker();
}
