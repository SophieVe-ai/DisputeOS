"use client";
import { useEffect, useRef, useState } from "react";
import { IconPlus } from "../ui/icons";
import { ACCEPT, SAMPLES_ROOT, type SamplePack } from "./types";

/** Drag-and-drop target with an animated marching-ants frame and floating document glyphs. */
/** Lists the bundled sample packs so the demo needs no files of your own. */
function SamplePicker({ onPick, busy }: { onPick: (slug: string) => void; busy: boolean }) {
  const [packs, setPacks] = useState<SamplePack[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${SAMPLES_ROOT}/index.json`)
      .then((r) => (r.ok ? (r.json() as Promise<SamplePack[]>) : []))
      .then((p) => alive && setPacks(p))
      .catch(() => alive && setPacks([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!packs?.length) return null;
  return (
    <section className="mt-6">
      <h3 className="label">No documents to hand? Try a sample case file</h3>
      <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {packs.map((p, i) => (
          <li key={p.slug} className="reveal" style={{ animationDelay: `${i * 70}ms` }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(p.slug)}
              className="card frame group flex h-full w-full flex-col items-start p-4 text-left transition-colors hover:border-line-2 disabled:opacity-50"
            >
              <span className="text-[13px] font-medium">{p.name}</span>
              <span className="mt-1.5 text-[12px] leading-snug text-ink-3">{p.description}</span>
              <span className="mt-auto flex w-full items-center justify-between pt-4 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
                {p.documents} documents
                <span className="text-ink-2 transition-transform duration-300 group-hover:translate-x-1">Use →</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Dropzone({ onFiles, onSample, busy }: { onFiles: (files: File[]) => void; onSample: (slug: string) => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <>
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
      }}
      className={`relative flex min-h-[320px] flex-col items-center justify-center overflow-hidden rounded-md p-10 text-center transition-colors duration-300 ${over ? "bg-white/[.04]" : "bg-[#070808]"}`}
    >
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
        <rect x="1" y="1" width="calc(100% - 2px)" height="calc(100% - 2px)" rx="6" fill="none" stroke={over ? "var(--ink)" : "var(--border-2)"} className="march" />
      </svg>
      <svg aria-hidden width="120" height="84" viewBox="0 0 120 84" className="float-y">
        {[{ x: 14, r: -10, o: 0.35 }, { x: 70, r: 9, o: 0.35 }, { x: 42, r: 0, o: 1 }].map((d, i) => (
          <g key={i} transform={`translate(${d.x} 10) rotate(${d.r} 18 24)`} opacity={d.o}>
            <rect width="36" height="48" rx="3" fill="var(--panel-2)" stroke="var(--ink-3)" />
            <path d="M24 0v10h12" fill="none" stroke="var(--ink-3)" />
            {[18, 25, 32, 39].map((y) => <line key={y} x1="7" x2={y === 39 ? 20 : 29} y1={y} y2={y} stroke="var(--ink-3)" strokeWidth="1.5" />)}
          </g>
        ))}
        <path d="M60 74v-14m-6 6 6-6 6 6" fill="none" stroke="var(--ink)" strokeWidth="1.5" className={over ? "" : "pop-tag"} />
      </svg>
      <h2 className="mt-6 text-[18px] font-normal tracking-[-0.01em]">{over ? "Release to analyse" : "Drop your case file here"}</h2>
      <p className="mt-2 max-w-md text-[13px] text-ink-3">
        Contracts, invoices, delivery notes, remittances and emails. <span className="font-mono">.txt .md .eml .csv .pdf</span> · up to 15 files, 2 MB each.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}><IconPlus size={14} /> Choose files</button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        aria-label="Upload documents"
        onChange={(e) => {
          if (e.target.files?.length) onFiles([...e.target.files]);
          e.target.value = "";
        }}
      />
    </div>
      <SamplePicker onPick={onSample} busy={busy} />
    </>
  );
}
