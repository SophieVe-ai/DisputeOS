// On-chain anchoring of ledger entry hashes. Agents never see this module:
// only the ledger service (which holds the signing key) can append.
import fs from "node:fs";
import { Contract, JsonRpcProvider, NonceManager, Wallet, id as keccakId } from "ethers";
import { config, HARDHAT_DEV_PRIVATE_KEY, LOCAL_CHAIN_ID } from "../config";

export const AUDIT_LOG_ABI = [
  "function append(bytes32 entryHash, bytes32 prevHash, bytes32 caseKey, string actor, string action) returns (uint256)",
  "function count() view returns (uint256)",
  "function head() view returns (bytes32)",
  "function hashesInRange(uint256 from, uint256 to) view returns (bytes32[])",
  "event EntryAnchored(uint256 indexed index, bytes32 indexed caseKey, bytes32 entryHash, bytes32 prevHash, string actor, string action, address writer)",
] as const;

export interface AnchorInfo {
  chainId: string;
  contractAddress: string;
  network: string;
  writer: string;
}

export interface AnchorRequest {
  entryHash: string;
  prevHash: string;
  caseId: string | null;
  actor: string;
  action: string;
}

export interface AnchorReceipt {
  txHash: string;
  blockNumber: number;
}

export interface AnchorClient {
  info(): AnchorInfo;
  append(req: AnchorRequest): Promise<AnchorReceipt>;
  count(): Promise<number>;
  hashesInRange(from: number, to: number): Promise<string[]>;
}

export function caseKey(caseId: string | null): string {
  return keccakId(caseId ?? "system");
}

/** In-memory anchor with the same append-only + chain-link rules as the contract. Used in tests. */
export class MemoryAnchor implements AnchorClient {
  private readonly hashes: string[] = [];
  private block = 0;

  info(): AnchorInfo {
    return { chainId: "memory", contractAddress: "0xmemory", network: "in-memory", writer: "0xledger" };
  }

  async append(req: AnchorRequest): Promise<AnchorReceipt> {
    const head = this.hashes.at(-1) ?? `0x${"0".repeat(64)}`;
    if (req.prevHash !== head) throw new Error(`BrokenChain: expected ${head}`);
    if (this.hashes.includes(req.entryHash)) throw new Error("DuplicateEntry");
    this.hashes.push(req.entryHash);
    this.block += 1;
    return { txHash: `0xtx${this.block}`, blockNumber: this.block };
  }

  async count(): Promise<number> {
    return this.hashes.length;
  }

  async hashesInRange(from: number, to: number): Promise<string[]> {
    return this.hashes.slice(from, to);
  }
}

class EvmAnchor implements AnchorClient {
  constructor(
    private readonly contract: Contract,
    private readonly details: AnchorInfo,
  ) {}

  info(): AnchorInfo {
    return this.details;
  }

  async append(req: AnchorRequest): Promise<AnchorReceipt> {
    const tx = await this.contract.append(
      req.entryHash,
      req.prevHash,
      caseKey(req.caseId),
      req.actor,
      req.action,
    );
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`Anchor transaction ${tx.hash} failed`);
    return { txHash: tx.hash, blockNumber: receipt.blockNumber };
  }

  async count(): Promise<number> {
    return Number(await this.contract.count());
  }

  async hashesInRange(from: number, to: number): Promise<string[]> {
    if (to <= from) return [];
    const out: string[] = await this.contract.hashesInRange(from, to);
    return out.map((h) => h.toLowerCase());
  }
}

function readDeploymentAddress(): string | null {
  if (config.contractAddress) return config.contractAddress;
  try {
    const raw = JSON.parse(fs.readFileSync(config.deploymentFile, "utf8")) as { address?: string };
    return raw.address ?? null;
  } catch {
    return null;
  }
}

export async function connectEvmAnchor(): Promise<AnchorClient> {
  const address = readDeploymentAddress();
  if (!address) {
    throw new Error("No AuditLog contract deployed (run `npm run chain:deploy` or set LEDGER_CONTRACT_ADDRESS)");
  }
  const provider = new JsonRpcProvider(config.rpcUrl, undefined, { staticNetwork: true });
  const network = await provider.getNetwork();
  const key = config.ledgerPrivateKey ?? (network.chainId === LOCAL_CHAIN_ID ? HARDHAT_DEV_PRIVATE_KEY : null);
  if (!key) {
    throw new Error(`LEDGER_PRIVATE_KEY is required for non-local chain ${network.chainId}`);
  }
  if (key === HARDHAT_DEV_PRIVATE_KEY && network.chainId !== LOCAL_CHAIN_ID) {
    throw new Error("Refusing to use the public Hardhat dev key on a non-local chain");
  }
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error(`No contract code at ${address} on chain ${network.chainId}`);
  const wallet = new Wallet(key, provider);
  const signer = new NonceManager(wallet);
  const contract = new Contract(address, AUDIT_LOG_ABI, signer);
  return new EvmAnchor(contract, {
    chainId: network.chainId.toString(),
    contractAddress: address,
    network: network.chainId === LOCAL_CHAIN_ID ? "hardhat-local" : network.name || `chain-${network.chainId}`,
    writer: wallet.address,
  });
}
