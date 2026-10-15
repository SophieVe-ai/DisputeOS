"use client";
import { IconEvidence } from "../ui/icons";

const STAGES = ["Extracting text", "Classifying documents", "Inferring parties and balance"];

/** Shown while the server extracts and classifies: each file gets its own scan line. */
export function Analysing({ files }: { files: File[] }) {
  return (
    <div className="card frame p-6" role="status" aria-live="polite">
      <div className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-[10.5px] uppercase tracking-[0.12em]">
        {STAGES.map((s, i) => (
          <span key={s} className="reveal flex items-center gap-2 text-ink-2" style={{ animationDelay: `${i * 350}ms` }}>
            <svg width="10" height="10" viewBox="0 0 10 10" className="spin" aria-hidden><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeOpacity=".25" /><path d="M5 1a4 4 0 0 1 4 4" fill="none" stroke="currentColor" /></svg>
            {s}
          </span>
        ))}
      </div>
      <ul className="mt-6 grid gap-2 md:grid-cols-2">
        {files.map((f, i) => (
          <li key={`${f.name}-${i}`} className="reveal relative flex items-center gap-3 overflow-hidden rounded border border-line bg-panel-2 px-3 py-2.5" style={{ animationDelay: `${i * 60}ms` }}>
            <IconEvidence size={15} className="text-ink-3" />
            <span className="truncate text-[13px]">{f.name}</span>
            <span className="ml-auto font-mono text-[10.5px] text-ink-3">{(f.size / 1024).toFixed(1)} KB</span>
            <span aria-hidden className="beam absolute inset-x-0 bottom-0 h-px" style={{ animationDelay: `${i * 120}ms` }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
