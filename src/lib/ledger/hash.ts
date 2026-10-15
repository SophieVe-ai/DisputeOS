import { createHash } from "node:crypto";

export const GENESIS_HASH = `0x${"0".repeat(64)}`;

/** Deterministic JSON: object keys sorted recursively so hashes are stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function sha256Hex(input: string): string {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

export interface EntryHashInput {
  seq: number;
  caseId: string | null;
  runId: string | null;
  actor: string;
  action: string;
  payloadHash: string;
  prevHash: string;
  createdAt: string;
}

export function computeEntryHash(input: EntryHashInput): string {
  return sha256Hex(canonicalJson({ v: 1, ...input }));
}
