"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CorrespondenceMessage, Wakeup } from "@/lib/types";
import { humanise, money, time } from "../format";
import { StatusBadge } from "../StatusBadge";
import { IconMail, IconNegotiation } from "../ui/icons";

type Item = { at: string; order: number } & ({ type: "message"; message: CorrespondenceMessage } | { type: "turn"; turn: Wakeup });

/** Replies sit where they arrived; deadline turns sit where their timer fired. Pending timers are shown in the header, not here. */
function timelineItems(messages: CorrespondenceMessage[], turns: Wakeup[]): Item[] {
  const shown = turns.filter((t) => t.kind === "reply" || ["processing", "done", "failed"].includes(t.status));
  return [
    ...messages.map((message): Item => ({ at: message.createdAt, order: 0, type: "message", message })),
    ...shown.map((turn): Item => ({ at: turn.kind === "reply" ? turn.createdAt : turn.dueAt, order: 1, type: "turn", turn })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);
}

function MessageRow({ m }: { m: CorrespondenceMessage }) {
  const inbound = m.direction === "inbound";
  return (
    <li className={`rounded border px-4 py-3 ${inbound ? "border-info/30 bg-panel-2" : "border-line bg-panel-2"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <IconMail size={14} className={inbound ? "text-info" : "text-ink-3"} />
        <span className="text-[13px] font-medium">{inbound ? `Reply from ${m.sender}` : `Sent: ${m.subject}`}</span>
        <span className="ml-auto font-mono text-[10.5px] text-ink-3">{time(m.createdAt)}</span>
      </div>
      {inbound ? (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{m.body}</p>
      ) : (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">Read letter</summary>
          <article className="prose-doc mt-3 max-h-[22rem] overflow-auto rounded bg-[#f7f6f2] p-6 text-[13px] text-[#1b1b19]">
            <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={["img"]} unwrapDisallowed>{m.body}</ReactMarkdown>
          </article>
        </details>
      )}
    </li>
  );
}

function TurnRow({ t }: { t: Wakeup }) {
  const out = t.output;
  const a = out?.analysis;
  const label = t.status === "scheduled" ? "queued until you decide" : t.status === "cancelled" ? "superseded" : t.status;
  return (
    <li className="rounded border border-line-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <IconNegotiation size={14} className="text-ink-2" />
        <span className="text-[13px] font-medium">Negotiation agent</span>
        <span className="font-mono text-[10.5px] text-ink-3">woken by {t.kind === "reply" ? "a reply" : `a deadline (${t.reason})`}</span>
        <span className="ml-auto"><StatusBadge status={t.status} label={label} /></span>
      </div>
      {t.status === "processing" && <p className="mt-2 text-[13px] text-info">Reading the reply and deciding the next move…</p>}
      {t.error && t.status !== "done" && <p className="mt-2 text-[12px] text-bad">Attempt {t.attempts}: {t.error}</p>}
      {out && (
        <div className="mt-3 space-y-2 text-[13px]">
          {a && (
            <div className="flex flex-wrap gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em]">
              <span className="rounded border border-line-2 px-2 py-0.5 text-ink">{humanise(a.intent)}</span>
              {a.amountPence !== null && <span className="rounded border border-line-2 px-2 py-0.5 text-ink-2">{money(a.amountPence)}</span>}
              {a.promisedDate && <span className="rounded border border-line-2 px-2 py-0.5 text-ink-2">by {a.promisedDate}</span>}
              {a.disputeTypes.map((d) => <span key={d} className="rounded border border-warn/40 px-2 py-0.5 text-warn">{humanise(d)}</span>)}
              <span className="px-1 py-0.5 text-ink-3">read by {a.source}{a.rejected ? ` · ${a.rejected} ungrounded discarded` : ""}</span>
            </div>
          )}
          <p className="text-ink-2"><span className="text-ink">Decision: {humanise(out.decision)}.</span> {out.rationale}</p>
          <p className="font-mono text-[10.5px] text-ink-3">On the table {money(out.demandPence)} · floor {money(out.floorPence)} · engine {t.engine}</p>
        </div>
      )}
    </li>
  );
}

export function Timeline({ messages, turns }: { messages: CorrespondenceMessage[]; turns: Wakeup[] }) {
  const items = timelineItems(messages, turns);
  if (items.length === 0) return null;
  return (
    <ol className="space-y-2" aria-label="Correspondence and agent turns">
      {items.map((item) => (item.type === "message" ? <MessageRow key={item.message.id} m={item.message} /> : <TurnRow key={item.turn.id} t={item.turn} />))}
    </ol>
  );
}
