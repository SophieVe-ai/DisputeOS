import type {
  CaseDocument,
  ChallengeOutput,
  DisputeCase,
  Engine,
  EvidenceOutput,
  ReconciliationOutput,
} from "../types";
import type { LlmClient } from "./llm";

/**
 * Everything an agent is allowed to touch. Note what is absent: no database handle,
 * no ledger reader, no signing key. `log` is an append-only closure whose actor is
 * fixed by the orchestrator, so an agent can add to its record but never alter it.
 */
export interface AgentContext {
  readonly caseFile: Readonly<DisputeCase>;
  readonly documents: readonly Readonly<CaseDocument>[];
  readonly asOf: string;
  readonly baseRatePercent: number;
  readonly prior: {
    readonly evidence?: EvidenceOutput;
    readonly reconciliation?: ReconciliationOutput;
    readonly challenge?: ChallengeOutput;
  };
  readonly llm: LlmClient | null;
  log(action: string, payload?: unknown): Promise<void>;
  pace(fraction?: number): Promise<void>;
}

export interface AgentResult<T> {
  output: T;
  engine: Engine;
}

export interface Agent<T> {
  readonly name: string;
  readonly title: string;
  run(ctx: AgentContext): Promise<AgentResult<T>>;
}

export function requirePrior<K extends keyof AgentContext["prior"]>(
  ctx: AgentContext,
  key: K,
): NonNullable<AgentContext["prior"][K]> {
  const value = ctx.prior[key];
  if (!value) throw new Error(`Agent dependency missing: ${String(key)} output not available`);
  return value as NonNullable<AgentContext["prior"][K]>;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
