import { challengeAgent } from "../agents/challenge";
import type { Agent } from "../agents/context";
import { evidenceAgent } from "../agents/evidence";
import { reconciliationAgent } from "../agents/reconciliation";
import { resolutionAgent } from "../agents/resolution";
import type { AgentName } from "../types";

export const AGENTS: Record<AgentName, Agent<unknown>> = {
  evidence: evidenceAgent,
  reconciliation: reconciliationAgent,
  challenge: challengeAgent,
  resolution: resolutionAgent,
};
