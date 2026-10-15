"use client";
// Live terminal of every ledger write and the EntryAnchored log the contract emitted for it.
// Rows mount as entries appear, so CSS mount animations play exactly once per new write.
import { useEffect, useRef, useState } from "react";
import type { ChainEvent } from "@/lib/ledger/anchor";
import type { ChainFeed, FeedEntry } from "@/lib/ledger/chain-feed";
import { usePoll } from "./api";
import { shortHash } from "./format";
import { IconBlock, IconTerminal } from "./ui/icons";
import { CountUp, Scramble } from "./ui/motion";

const POLL_MS = 900;
const FEED_LIMIT = 120;
const STICK_THRESHOLD_PX = 48;
const MAX_BLOCKS = 9;
const GAS = new Intl.NumberFormat("en-GB");

const clock = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

function actorClass(actor: string): string {
  if (actor.startsWith("human:")) return "text-warn";
  if (actor.startsWith("agent:")) return "text-info";
  return "text-ink-2";
}

function Spinner() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className="spin inline-block" aria-hidden>
      <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeOpacity=".25" />
      <path d="M5 1a4 4 0 0 1 4 4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function Sub({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`pl-5 ${className}`}><span className="text-ink-3">↳ </span>{children}</div>;
}

function MinedLines({ entry, event }: { entry: FeedEntry; event: ChainEvent }) {
  return (
    <div className="mined-flash">
      <Sub>
        <span className="text-good">mined</span> <span className="text-ink-3">tx</span> <Scramble text={shortHash(event.txHash)} className="text-ink" />{" "}
        <span className="text-ink-3">block</span> <span className="text-ink">#{event.blockNumber}</span>
        {event.gasUsed && <> <span className="text-ink-3">gas</span> <span className="text-ink-2">{GAS.format(Number(event.gasUsed))}</span></>}
      </Sub>
      <Sub>
        <span className="text-ink-2">emit</span> <span className="text-ink">EntryAnchored</span>
        <span className="text-ink-3">(index: </span><span className="text-ink-2">{event.index}</span>
        <span className="text-ink-3">, caseKey: </span><span className="text-ink-2">{shortHash(event.caseKey)}</span>
        <span className="text-ink-3">, writer: </span><span className="text-ink-2">{shortHash(event.writer)}</span>
        <span className="text-ink-3">)</span>
      </Sub>
      {entry.hashMatches ? (
        <Sub><span className="text-good">✓ on-chain hash matches ledger</span></Sub>
      ) : (
        <Sub className="glitch text-bad">
          ✕ MISMATCH ledger {shortHash(entry.entryHash)} ≠ chain {shortHash(event.entryHash)}
        </Sub>
      )}
    </div>
  );
}

function AnchorState({ entry }: { entry: FeedEntry }) {
  if (entry.hashMatches === false) return <span className="text-bad">✕ altered</span>;
  if (entry.event) return <span key="mined" className="mined-flash rounded px-1 text-good">✓ block #{entry.event.blockNumber}</span>;
  if (entry.anchorStatus === "error") return <span className="text-bad">retrying</span>;
  if (entry.anchorStatus === "anchored") return <span className="text-good">✓ on-chain</span>;
  return <span className="text-warn"><Spinner /> writing</span>;
}

function EntryRow({ entry, technical }: { entry: FeedEntry; technical: boolean }) {
  const pending = !entry.event && entry.anchorStatus === "pending";
  return (
    <div className={`line-in rounded-sm px-2 py-1.5 ${entry.hashMatches === false ? "bg-bad/[.06]" : ""}`}>
      <div className="flex items-baseline gap-3 whitespace-nowrap">
        <span className="shrink-0 text-ink-3">{technical ? clock(entry.createdAt) : clock(entry.createdAt).slice(0, 8)}</span>
        <span className={`truncate ${actorClass(entry.actor)}`}>{entry.actor.replace(/^(agent|human|system):/, "")}</span>
        <span className="ml-auto shrink-0 text-[10.5px]"><AnchorState entry={entry} /></span>
      </div>
      <p className="mt-0.5 whitespace-normal font-sans text-[12.5px] leading-snug text-ink">{entry.description}</p>
      {technical && <TechnicalLines entry={entry} pending={pending} />}
    </div>
  );
}

function TechnicalLines({ entry, pending }: { entry: FeedEntry; pending: boolean }) {
  return (
    <div className="mt-1">
      <Sub><span className="text-ink-3">#{String(entry.seq).padStart(3, "0")}</span> <span className="text-ink-2">{entry.action}</span></Sub>
      <Sub>
        <span className="text-ink-3">sha256</span> <Scramble text={shortHash(entry.entryHash)} className="text-ink-2" />{" "}
        <span className="text-ink-3">prev</span> <span className="text-ink-3">{shortHash(entry.prevHash)}</span>
      </Sub>
      {pending && (
        <Sub className="text-ink-2">
          <span className="text-ink-3">eth_sendTransaction</span> AuditLog.append(bytes32,bytes32,bytes32,string,string){" "}
          <span className="text-warn"><Spinner /> awaiting block</span>
        </Sub>
      )}
      {entry.anchorStatus === "error" && !entry.event && <Sub className="text-bad">✕ {entry.anchorError ?? "anchor failed"} — will retry</Sub>}
      {!entry.event && entry.anchorStatus === "anchored" && <Sub className="text-ink-3">anchored (log outside scan window)</Sub>}
      {entry.event && <MinedLines key={entry.event.txHash} entry={entry} event={entry.event} />}
    </div>
  );
}

function BlockStrip({ events, latestBlock }: { events: ChainEvent[]; latestBlock: number }) {
  const blocks = [...new Map(events.map((e) => [e.blockNumber, e])).values()].slice(-MAX_BLOCKS);
  if (blocks.length === 0) return <div className="flex h-[54px] items-center font-mono text-[11px] text-ink-3">No blocks yet.</div>;
  return (
    <ol className="flex h-[54px] items-center gap-0 overflow-hidden" aria-label="Recently mined blocks">
      {blocks.map((b, i) => {
        const newest = b.blockNumber === latestBlock || i === blocks.length - 1;
        return (
          <li key={b.blockNumber} className="block-in flex items-center">
            {i > 0 && (
              <svg width="18" height="2" aria-hidden className="text-line-2"><line x1="0" x2="18" y1="1" y2="1" stroke="currentColor" className="draw" style={{ ["--len" as string]: 18 }} /></svg>
            )}
            <div className={`flex flex-col items-center gap-1 rounded px-1.5 py-1 ${newest ? "text-good" : "text-ink-3"}`} title={`Block ${b.blockNumber} · ${b.blockHash}`}>
              <span className="relative">
                {newest && <span aria-hidden className="ping absolute inset-0 rounded-full bg-good/30" />}
                <IconBlock size={20} />
              </span>
              <span className="font-mono text-[9.5px] tabular-nums">#{b.blockNumber}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ChainConsole({ caseId, className = "", heightClass = "h-[460px]" }: { caseId?: string; className?: string; heightClass?: string }) {
  const url = `/api/chain/feed?limit=${FEED_LIMIT}${caseId ? `&caseId=${encodeURIComponent(caseId)}` : ""}`;
  const { data, error } = usePoll<ChainFeed>(url, POLL_MS);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [technical, setTechnical] = useState(false);

  const entries = data?.entries ?? [];
  const events = entries.flatMap((e) => (e.event ? [e.event] : []));
  const last = entries.at(-1);
  const tailKey = last ? `${entries.length}:${last.seq}:${last.anchorStatus}:${events.length}` : "";
  const pendingCount = entries.filter((e) => !e.event && e.anchorStatus !== "anchored").length;
  const chain = data?.chain;

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [tailKey]);

  return (
    <section aria-labelledby="chain-console-title" className={`card frame flex flex-col overflow-hidden ${className}`}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <IconTerminal size={15} className="text-ink-2" />
        <h2 id="chain-console-title" className="text-[13px] font-medium">On-chain write log</h2>
        <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] ${chain?.connected ? "text-good" : "text-warn"}`}>
          <span className="relative flex h-1.5 w-1.5">
            {chain?.connected && <span className="ping absolute inset-0 rounded-full bg-good" />}
            <span className={`relative h-1.5 w-1.5 rounded-full ${chain?.connected ? "bg-good" : "bg-warn"}`} />
          </span>
          {chain ? (chain.connected ? "live" : "offline") : "connecting"}
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-ink-3">
          {chain?.connected ? <>block <span className="text-ink"><CountUp value={chain.latestBlock} format={(n) => `#${Math.round(n)}`} /></span></> : null}
        </span>
        <button
          type="button"
          aria-pressed={technical}
          onClick={() => setTechnical(!technical)}
          className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors ${technical ? "border-line-2 bg-white/[.06] text-ink" : "border-line text-ink-3 hover:text-ink-2"}`}
        >
          Technical
        </button>
      </header>
      <p className="border-b border-line px-4 py-2 text-[12px] leading-snug text-ink-3">
        Every action is written to the AuditLog smart contract as it happens. Once a write is mined it can never be edited or deleted.
      </p>

      <div className={`grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 font-mono text-[10.5px] ${technical ? "grid" : "hidden"}`}>
        <span className="text-ink-3">network</span>
        <span className="truncate text-ink-2">{chain?.connected ? `${chain.network} · chain ${chain.chainId}` : (chain?.error ?? "—")}</span>
        <span className="text-ink-3">contract</span>
        <span className="truncate text-ink-2">{chain?.connected ? <Scramble text={chain.contractAddress} /> : "—"}</span>
      </div>

      <div className="border-b border-line px-4">
        <BlockStrip events={events} latestBlock={chain?.connected ? chain.latestBlock : -1} />
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
        }}
        className={`wipe overflow-auto bg-[#060707] px-2 py-2 font-mono text-[11px] leading-[1.6] ${heightClass}`}
        role="log"
        aria-live="off"
        aria-label="Blockchain writes"
      >
        {error && !data && <p role="alert" className="px-2 text-bad">Couldn&apos;t load chain feed: {error}</p>}
        {data && entries.length === 0 && <p className="px-2 py-1 font-sans text-[12.5px] text-ink-3">Nothing written yet. Upload a case file and run the agents: each step will appear here as it lands on the chain.</p>}
        {entries.map((e) => <EntryRow key={e.seq} entry={e} technical={technical} />)}
        <div className="px-2 pt-1 text-ink-3">
          $ <span className="caret inline-block h-[13px] w-[7px] translate-y-[2px] bg-ink-2" />
        </div>
      </div>

      <footer className="flex items-center gap-4 whitespace-nowrap border-t border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
        <span>{entries.length} writes</span>
        <span className="text-good">{events.length} mined</span>
        <span className={pendingCount ? "text-warn" : ""}>{pendingCount} pending</span>
        <span className="ml-auto hidden truncate normal-case tracking-normal 2xl:inline">topic0 {shortHash(events[0]?.topics[0])}</span>
      </footer>
    </section>
  );
}
