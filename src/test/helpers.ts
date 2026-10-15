import { openDb, setDb } from "@/lib/db";
import { MemoryAnchor } from "@/lib/ledger/anchor";
import { setAnchorForTesting } from "@/lib/ledger/anchor-registry";
import { syncAnchors } from "@/lib/ledger/ledger";
import { seedDemoData } from "@/lib/seed";

export const AS_OF = "2026-10-15";

export function freshEnvironment(opts: { seed?: boolean; chain?: boolean } = {}): MemoryAnchor | null {
  setDb(openDb(":memory:"));
  const anchor = opts.chain === false ? null : new MemoryAnchor();
  setAnchorForTesting(anchor);
  if (opts.seed) seedDemoData();
  return anchor;
}

export async function flushAnchors(): Promise<void> {
  await syncAnchors();
  await syncAnchors();
}
