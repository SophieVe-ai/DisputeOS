import path from "node:path";

// Hardhat's well-known account #0. Public test key — only ever accepted on chainId 31337.
export const HARDHAT_DEV_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const LOCAL_CHAIN_ID = BigInt(31337);

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  }
  return n;
}

export const config = {
  get databasePath(): string {
    return process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "disputeos.db");
  },
  get deploymentFile(): string {
    return path.join(process.cwd(), ".chain", "deployment.json");
  },
  get rpcUrl(): string {
    return process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
  },
  get ledgerPrivateKey(): string | null {
    return process.env.LEDGER_PRIVATE_KEY || null;
  },
  get contractAddress(): string | null {
    return process.env.LEDGER_CONTRACT_ADDRESS || null;
  },
  get anthropicEnabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.DISPUTEOS_ENGINE !== "deterministic";
  },
  get claudeModel(): string {
    return process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
  },
  /** Bank of England base rate used for statutory interest. Verify against the current published rate. */
  get boeBaseRatePercent(): number {
    return numberEnv("BOE_BASE_RATE", 4.0);
  },
  /** Artificial pause between agent actions so a live demo is watchable. */
  get stepDelayMs(): number {
    return numberEnv("DEMO_STEP_DELAY_MS", 1200);
  },
  get demoMode(): boolean {
    return process.env.DEMO_MODE === "1";
  },
  get approvalPin(): string | null {
    return process.env.APPROVAL_PIN || null;
  },
  get workerEnabled(): boolean {
    return process.env.DISABLE_WORKER !== "1";
  },
};
