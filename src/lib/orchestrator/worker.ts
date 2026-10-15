// Background worker: leases runs from SQLite and advances them one agent step at a time,
// and leases due Negotiation agent wake-ups (debtor replies, lapsed deadlines).
// Leases expire, so a crashed or restarted server resumes in-flight work automatically.
import { config } from "../config";
import { syncAnchors } from "../ledger/ledger";
import { claimNextRun, updateRun } from "../repo/runs";
import { claimDueWakeup } from "../repo/wakeups";
import { processWakeup } from "./engagement";
import { advanceRun } from "./runner";

const TICK_MS = 750;
const LEASE_MS = 5 * 60_000;
const MAX_CONCURRENT_RUNS = 3;
const MAX_CONCURRENT_TURNS = 3;
const ANCHOR_SYNC_EVERY_TICKS = 8;

interface WorkerState {
  started: boolean;
  active: Set<string>;
  turns: Set<string>;
  ticks: number;
  timer: ReturnType<typeof setInterval> | null;
  lastTickAt: string | null;
}

const g = globalThis as unknown as { __disputeosWorker?: WorkerState };

function state(): WorkerState {
  g.__disputeosWorker ??= { started: false, active: new Set(), turns: new Set(), ticks: 0, timer: null, lastTickAt: null };
  return g.__disputeosWorker;
}

async function processRun(runId: string): Promise<void> {
  const s = state();
  try {
    const run = await advanceRun(runId);
    if (run.status === "running" && run.leaseUntil && run.attempts === 0) {
      updateRun(runId, { leaseUntil: null }); // release so the next tick picks up the next step
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

export function tick(): void {
  const s = state();
  s.ticks += 1;
  s.lastTickAt = new Date().toISOString();
  while (s.active.size < MAX_CONCURRENT_RUNS) {
    const run = claimNextRun(LEASE_MS, [...s.active]);
    if (!run) break;
    s.active.add(run.id);
    void processRun(run.id);
  }
  while (s.turns.size < MAX_CONCURRENT_TURNS) {
    const wakeup = claimDueWakeup(LEASE_MS, [...s.turns]);
    if (!wakeup) break;
    s.turns.add(wakeup.id);
    void processTurn(wakeup.id);
  }
  if (s.ticks % ANCHOR_SYNC_EVERY_TICKS === 0) void syncAnchors();
}

export function startWorker(): void {
  const s = state();
  if (s.started || !config.workerEnabled) return;
  s.started = true;
  s.timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      console.error("[worker] tick failed", err);
    }
  }, TICK_MS);
  s.timer.unref?.();
  void syncAnchors();
  console.log("[worker] DisputeOS agent worker started");
}

export function workerStatus(): { running: boolean; activeRuns: number; activeTurns: number; lastTickAt: string | null } {
  const s = state();
  return { running: s.started, activeRuns: s.active.size, activeTurns: s.turns.size, lastTickAt: s.lastTickAt };
}
