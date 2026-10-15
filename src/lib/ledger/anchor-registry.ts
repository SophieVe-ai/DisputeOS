import { AsyncLocalStorage } from "node:async_hooks";
import { connectEvmAnchor, type AnchorClient } from "./anchor";

/** An anchor scoped to one async call tree (the eval sandbox's in-memory chain). Shared across module copies. */
const scopedStore = globalThis as unknown as { __disputeosAnchorScope?: AsyncLocalStorage<AnchorClient> };
const scoped = (scopedStore.__disputeosAnchorScope ??= new AsyncLocalStorage<AnchorClient>());

/** Runs `fn` with `client` as the chain, without touching the app's live connection. */
export function withAnchor<T>(client: AnchorClient, fn: () => Promise<T>): Promise<T> {
  return scoped.run(client, fn);
}

const RETRY_AFTER_MS = 5_000;

interface AnchorState {
  client: AnchorClient | null;
  override: boolean;
  lastError: string | null;
  lastAttempt: number;
  connecting: Promise<AnchorClient | null> | null;
}

const g = globalThis as unknown as { __disputeosAnchor?: AnchorState };

function state(): AnchorState {
  g.__disputeosAnchor ??= { client: null, override: false, lastError: null, lastAttempt: 0, connecting: null };
  return g.__disputeosAnchor;
}

/** Returns a connected anchor client, or null if the chain is unavailable (retries with backoff). */
export async function getAnchor(): Promise<AnchorClient | null> {
  const sandbox = scoped.getStore();
  if (sandbox) return sandbox;
  const s = state();
  if (s.client) return s.client;
  if (s.override) return null;
  if (s.connecting) return s.connecting;
  if (Date.now() - s.lastAttempt < RETRY_AFTER_MS) return null;
  s.lastAttempt = Date.now();
  s.connecting = connectEvmAnchor()
    .then((client) => {
      s.client = client;
      s.lastError = null;
      return client;
    })
    .catch((err: unknown) => {
      s.lastError = err instanceof Error ? err.message : String(err);
      return null;
    })
    .finally(() => {
      s.connecting = null;
    });
  return s.connecting;
}

export function anchorError(): string | null {
  return state().lastError;
}

/** Drops the cached client so the next call reconnects (e.g. after an RPC failure). */
export function resetAnchor(error?: string): void {
  const s = state();
  if (s.override) return;
  s.client = null;
  s.lastError = error ?? null;
  s.lastAttempt = Date.now();
}

/** Test hook: pin a specific anchor client (or null for "chain unavailable"). */
export function setAnchorForTesting(client: AnchorClient | null): void {
  g.__disputeosAnchor = { client, override: true, lastError: client ? null : "disabled", lastAttempt: 0, connecting: null };
}
