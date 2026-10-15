"use client";
import Image from "next/image";
import Link from "next/link";
import type { ChainFeed } from "@/lib/ledger/chain-feed";
import { usePoll } from "./api";
import type { SystemStatus } from "./SystemBar";
import { IconArrowRight, IconScan } from "./ui/icons";
import { CountUp, Reveal, WordReveal } from "./ui/motion";

/** Crosshair that locks onto the glowing block in the hero image and reads out live chain state. */
function Reticle({ block, anchored }: { block: number | null; anchored: number | null }) {
  return (
    <div aria-hidden className="pointer-events-none absolute left-[58.5%] top-[50%] hidden -translate-x-1/2 -translate-y-1/2 xl:block">
      <svg width="190" height="190" viewBox="0 0 190 190" className="reticle-lock">
        <circle cx="95" cy="95" r="70" fill="none" stroke="rgba(255,255,255,.18)" strokeDasharray="2 6" className="spin-slow" />
        <circle cx="95" cy="95" r="54" fill="none" stroke="rgba(255,255,255,.35)" />
        {[0, 90, 180, 270].map((a) => (
          <line key={a} x1="95" y1="10" x2="95" y2="30" stroke="#fff" strokeOpacity=".7" transform={`rotate(${a} 95 95)`} />
        ))}
        <path d="M60 60h-10v10M130 60h10v10M60 130h-10v-10M130 130h10v-10" fill="none" stroke="#fff" strokeOpacity=".9" />
      </svg>
      <div className="absolute left-[170px] top-[34px] w-max rounded-sm border border-white/10 bg-bg/75 px-2.5 py-1.5 backdrop-blur-md font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-ink-2">
        <div className="flex items-center gap-2 text-good">
          <span className="relative flex h-1.5 w-1.5"><span className="ping absolute inset-0 rounded-full bg-good" /><span className="relative h-1.5 w-1.5 rounded-full bg-good" /></span>
          anchored
        </div>
        <div>block <span className="text-ink"><CountUp value={block} format={(n) => `#${Math.round(n)}`} /></span></div>
        <div>entries <span className="text-ink"><CountUp value={anchored} format={(n) => String(Math.round(n))} /></span></div>
      </div>
    </div>
  );
}

export function HomeHero() {
  const { data: system } = usePoll<SystemStatus>("/api/system", 3000);
  const { data: feed } = usePoll<ChainFeed>("/api/chain/feed?limit=1", 3000);
  const block = feed?.chain.connected ? feed.chain.latestBlock : null;

  return (
    <section className="relative left-1/2 -mt-10 w-screen -translate-x-1/2 overflow-hidden border-b border-line">
      <div aria-hidden className="absolute inset-0">
        <div className="absolute inset-y-0 right-0 w-full lg:w-[70%]">
          <Image src="/images/hero-chain.jpg" alt="" fill priority sizes="(min-width: 1024px) 70vw, 100vw" className="kenburns object-cover object-center opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/30 to-transparent" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-bg/90 via-bg/40 to-transparent lg:from-bg lg:via-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/60" />
        <div className="light-sweep absolute inset-0 overflow-hidden" />
        <svg className="absolute inset-0 h-full w-full opacity-[.15]">
          <defs>
            <pattern id="hero-grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#fff" strokeWidth=".5" /></pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hero-grid)" />
        </svg>
      </div>
      <Reticle block={block} anchored={system?.ledger.anchored ?? null} />

      <div className="relative mx-auto max-w-[1400px] px-6 pb-24 pt-24 md:pb-32 md:pt-32">
        <Reveal className="flex items-center gap-3">
          <span className="h-px w-8 bg-ink-3" />
          <span className="label">Autonomous dispute resolution · UK SMEs</span>
        </Reveal>
        <h1 className="mt-7 max-w-3xl text-[44px] font-normal leading-[1.02] tracking-[-0.04em] md:text-[72px]">
          <WordReveal delayMs={120}>Recover late payments.</WordReveal>
          <br />
          <span className="text-ink-3"><WordReveal delayMs={360}>Provably fairly.</WordReveal></span>
        </h1>
        <Reveal delay={650}>
          <p className="mt-7 max-w-xl text-[16px] leading-relaxed text-ink-2">
            UK businesses are owed <span className="text-ink">£26.5bn</span> in late payments. Upload a case file and four agents gather the evidence,
            reconcile the numbers, argue the debtor&apos;s side and draft the response. Every step is anchored on-chain,
            and nothing leaves without a named human&apos;s approval.
          </p>
        </Reveal>
        <Reveal delay={800} className="mt-9 flex flex-wrap gap-3">
          <Link href="/cases/new" className="btn btn-primary h-10 px-5">Upload a case file <IconArrowRight size={14} /></Link>
          <Link href="/evals" className="btn btn-ghost h-10 px-5"><IconScan size={14} /> Evaluate the agents</Link>
        </Reveal>
        <Reveal delay={950} className="mt-14 flex flex-wrap gap-x-10 gap-y-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
          <span>Network <span className="text-ink-2">{system?.chain.connected ? system.chain.network : "offline"}</span></span>
          <span>Latest block <span className="text-ink-2">{block === null ? "—" : `#${block}`}</span></span>
          <span>Engine <span className="text-ink-2">{system ? (system.engine.mode === "claude" ? system.engine.model : "deterministic") : "—"}</span></span>
          <span>Human gate <span className="text-ink-2">enforced</span></span>
        </Reveal>
      </div>
    </section>
  );
}
