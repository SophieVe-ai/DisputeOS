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

/** A decoded `EntryAnchored` log read back from the chain, with its transaction context. */
export interface ChainEvent {
  index: number;
  caseKey: string;
  entryHash: string;
  prevHash: string;
  actor: string;
  action: string;
  writer: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number | null;
  txHash: string;
  logIndex: number;
  gasUsed: string | null;
  topics: string[];
}

export interface AnchorClient {
  info(): AnchorInfo;
  append(req: AnchorRequest): Promise<AnchorReceipt>;
  count(): Promise<number>;
  hashesInRange(from: number, to: number): Promise<string[]>;
  latestBlock(): Promise<number>;
  /** Most recent `EntryAnchored` logs (ascending), optionally filtered by case via the indexed topic. */
  events(opts: { caseId?: string | null; limit: number }): Promise<ChainEvent[]>;
}

export const ENTRY_ANCHORED_TOPIC = keccakId("EntryAnchored(uint256,bytes32,bytes32,bytes32,string,string,address)");
/** How far back to scan for logs; keeps getLogs within typical RPC range limits. */
const EVENT_LOOKBACK_BLOCKS = 5_000;

export function caseKey(caseId: string | null): string {
  return keccakId(caseId ?? "system");
}

/** In-memory anchor with the same append-only + chain-link rules as the contract. Used in tests. */
export class MemoryAnchor implements AnchorClient {
  private readonly hashes: string[] = [];
  private readonly logs: ChainEvent[] = [];
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
    const key = caseKey(req.caseId);
    const txHash = `0xtx${this.block}`;
    this.logs.push({
      index: this.hashes.length - 1,
      caseKey: key,
      entryHash: req.entryHash,
      prevHash: req.prevHash,
      actor: req.actor,
      action: req.action,
      writer: "0xledger",
      blockNumber: this.block,
      blockHash: `0xblock${this.block}`,
      blockTimestamp: null,
      txHash,
      logIndex: 0,
      gasUsed: null,
      topics: [ENTRY_ANCHORED_TOPIC, `0x${(this.hashes.length - 1).toString(16).padStart(64, "0")}`, key],
    });
    return { txHash, blockNumber: this.block };
  }

  async latestBlock(): Promise<number> {
    return this.block;
  }

  async events(opts: { caseId?: string | null; limit: number }): Promise<ChainEvent[]> {
    const key = opts.caseId === undefined ? null : caseKey(opts.caseId);
    return this.logs.filter((l) => key === null || l.caseKey === key).slice(-opts.limit);
  }

  async count(): Promise<number> {
    return this.hashes.length;
  }

  async hashesInRange(from: number, to: number): Promise<string[]> {
    return this.hashes.slice(from, to);
  }
}

class EvmAnchor implements AnchorClient {
  // Receipts and blocks are immutable once mined, so caching them is safe.
  private readonly gasByTx = new Map<string, string>();
  private readonly timeByBlock = new Map<number, number>();

  constructor(
    private readonly contract: Contract,
    private readonly provider: JsonRpcProvider,
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

  async latestBlock(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async events(opts: { caseId?: string | null; limit: number }): Promise<ChainEvent[]> {
    const latest = await this.provider.getBlockNumber();
    const filter = this.contract.filters.EntryAnchored(null, opts.caseId === undefined ? null : caseKey(opts.caseId));
    const logs = (await this.contract.queryFilter(filter, Math.max(0, latest - EVENT_LOOKBACK_BLOCKS), latest)).slice(-opts.limit);
    return Promise.all(
      logs.map(async (log) => {
        if (!("args" in log)) throw new Error(`Undecodable log in tx ${log.transactionHash}`);
        const [index, key, entryHash, prevHash, actor, action, writer] = log.args as unknown as [bigint, string, string, string, string, string, string];
        return {
          index: Number(index),
          caseKey: key,
          entryHash: entryHash.toLowerCase(),
          prevHash: prevHash.toLowerCase(),
          actor,
          action,
          writer,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          blockTimestamp: await this.blockTime(log.blockNumber),
          txHash: log.transactionHash,
          logIndex: log.index,
          gasUsed: await this.gasUsed(log.transactionHash),
          topics: [...log.topics],
        };
      }),
    );
  }

  private async gasUsed(txHash: string): Promise<string | null> {
    const cached = this.gasByTx.get(txHash);
    if (cached) return cached;
    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (!receipt) return null;
    const gas = receipt.gasUsed.toString();
    this.gasByTx.set(txHash, gas);
    return gas;
  }

  private async blockTime(blockNumber: number): Promise<number | null> {
    const cached = this.timeByBlock.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await this.provider.getBlock(blockNumber);
    if (!block) return null;
    this.timeByBlock.set(blockNumber, block.timestamp);
    return block.timestamp;
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
  return new EvmAnchor(contract, provider, {
    chainId: network.chainId.toString(),
    contractAddress: address,
    network: network.chainId === LOCAL_CHAIN_ID ? "hardhat-local" : network.name || `chain-${network.chainId}`,
    writer: wallet.address,
  });
}
