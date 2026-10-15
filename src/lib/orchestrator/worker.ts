// Local background worker: a long-lived process (npm run dev / demo) polls for due runs and
// Negotiation agent wake-ups. On Vercel this is replaced by drain.ts (after() + cron).
// Leases expire, so a crashed or restarted server resumes in-flight work automatically.
import { config } from "../config";
import { syncAnchors } from "../ledger/ledger";
import { claimNextRun, updateRun } from "../repo/runs";
import { claimDueWakeup } from "../repo/wakeups";
import { LEASE_MS } from "./drain";
import { processWakeup } from "./engagement";
import { advanceRun } from "./runner";

const TICK_MS = 750;
const MAX_CONCURRENT_RUNS = 3;
const MAX_CONCURRENT_TURNS = 3;
const ANCHOR_SYNC_EVERY_TICKS = 8;

interface WorkerState {
  started: boolean;
  ticking: boolean;
  active: Set<string>;
  turns: Set<string>;
  ticks: number;
  timer: ReturnType<typeof setInterval> | null;
  lastTickAt: string | null;
}

const g = globalThis as unknown as { __disputeosWorker?: WorkerState };

function state(): WorkerState {
  g.__disputeosWorker ??= { started: false, ticking: false, active: new Set(), turns: new Set(), ticks: 0, timer: null, lastTickAt: null };
  return g.__disputeosWorker;
}

async function processRun(runId: string): Promise<void> {
  const s = state();
  try {
    const run = await advanceRun(runId);
    if (run.status === "running" && run.leaseUntil && run.attempts === 0) {
      await updateRun(runId, { leaseUntil: null }); // release so the next tick picks up the next step
    }
  } catch (err) {
    console.error(`[worker] run ${runId} crashed`, err);
  } finally {
    s.active.delete(runId);
  }
}

async function processTurn(wakeupId: string): Promise<void> {
  const s = state();
  try {
    await processWakeup(wakeupId);
  } catch (err) {
    console.error(`[worker] negotiation turn ${wakeupId} crashed`, err);
  } finally {
    s.turns.delete(wakeupId);
  }
}

export async function tick(): Promise<void> {
  const s = state();
  if (s.ticking) return; // a slow database never stacks overlapping ticks
  s.ticking = true;
  try {
    s.ticks += 1;
    s.lastTickAt = new Date().toISOString();
    while (s.active.size < MAX_CONCURRENT_RUNS) {
      const run = await claimNextRun(LEASE_MS, [...s.active]);
      if (!run) break;
      s.active.add(run.id);
      void processRun(run.id);
    }
    while (s.turns.size < MAX_CONCURRENT_TURNS) {
      const wakeup = await claimDueWakeup(LEASE_MS, [...s.turns]);
      if (!wakeup) break;
      s.turns.add(wakeup.id);
      void processTurn(wakeup.id);
    }
    if (s.ticks % ANCHOR_SYNC_EVERY_TICKS === 0) void syncAnchors();
  } finally {
    s.ticking = false;
  }
}

export function startWorker(): void {
  const s = state();
  if (s.started || !config.workerEnabled || config.serverless) return;
  s.started = true;
  s.timer = setInterval(() => {
    tick().catch((err: unknown) => console.error("[worker] tick failed", err));
  }, TICK_MS);
  s.timer.unref?.();
  void syncAnchors();
  console.log("[worker] DisputeOS agent worker started");
}

export function workerStatus(): { running: boolean; mode: "worker" | "serverless"; activeRuns: number; activeTurns: number; lastTickAt: string | null } {
  const s = state();
  return { running: s.started || config.serverless, mode: config.serverless ? "serverless" : "worker", activeRuns: s.active.size, activeTurns: s.turns.size, lastTickAt: s.lastTickAt };
}
