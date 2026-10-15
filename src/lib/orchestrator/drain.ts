// Serverless work driver. On Vercel there is no long-lived process to run a polling worker,
// so every request that creates work calls `kick()`, which keeps draining after the response
// is sent (Next.js `after`), and a Vercel Cron job drains anything left (e.g. a deadline that
// fell due while nobody was looking). Claims use row leases with SKIP LOCKED, so any number of
// concurrent drains across instances is safe.
import { after } from "next/server";
import { config } from "../config";
import { syncAnchors } from "../ledger/ledger";
import { claimNextRun, updateRun } from "../repo/runs";
import { claimDueWakeup } from "../repo/wakeups";
import { processWakeup } from "./engagement";
import { advanceRun } from "./runner";

/** Lease held while one step or turn runs; an expired lease means the worker died mid-task. */
export const LEASE_MS = 5 * 60_000;
/** Stay well inside the function's maxDuration (300s) so the last task can finish cleanly. */
export const DRAIN_BUDGET_MS = 240_000;

export interface DrainResult {
  steps: number;
  turns: number;
}

/** Works through due runs and wake-ups until none are left or the time budget is spent. */
export async function drain(budgetMs = DRAIN_BUDGET_MS): Promise<DrainResult> {
  const deadline = Date.now() + budgetMs;
  const result: DrainResult = { steps: 0, turns: 0 };
  while (Date.now() < deadline) {
    const run = await claimNextRun(LEASE_MS);
    if (run) {
      const advanced = await advanceRun(run.id);
      if (advanced.status === "running" && advanced.leaseUntil && advanced.attempts === 0) await updateRun(run.id, { leaseUntil: null });
      result.steps += 1;
      continue;
    }
    const wakeup = await claimDueWakeup(LEASE_MS);
    if (wakeup) {
      await processWakeup(wakeup.id);
      result.turns += 1;
      continue;
    }
    break;
  }
  await syncAnchors();
  return result;
}

/** Keeps working after the response on Vercel. Locally the long-lived worker handles it. */
export function kick(): void {
  if (!config.serverless) return;
  after(async () => {
    try {
      await drain();
    } catch (err) {
      console.error("[drain] failed", err);
    }
  });
}
