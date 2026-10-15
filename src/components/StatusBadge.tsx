type Tone = "idle" | "live" | "warn" | "good" | "bad" | "muted";

const TONE: Record<string, Tone> = {
  open: "idle",
  in_review: "live",
  queued: "live",
  running: "live",
  awaiting_approval: "warn",
  pending: "warn",
  approved: "good",
  executed: "good",
  resolved: "good",
  completed: "good",
  done: "good",
  anchored: "good",
  match: "good",
  rebutted: "good",
  upheld: "warn",
  partially_upheld: "warn",
  missing: "warn",
  rejected: "bad",
  failed: "bad",
  error: "bad",
  mismatch: "bad",
  unavailable: "muted",
  closed: "muted",
};

const TONE_CLASS: Record<Tone, { text: string; dot: string }> = {
  idle: { text: "text-ink-2", dot: "bg-ink-3" },
  live: { text: "text-info", dot: "bg-info" },
  warn: { text: "text-warn", dot: "bg-warn" },
  good: { text: "text-good", dot: "bg-good" },
  bad: { text: "text-bad", dot: "bg-bad" },
  muted: { text: "text-ink-3", dot: "bg-ink-3" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = TONE[status] ?? "idle";
  const cls = TONE_CLASS[tone];
  const animated = tone === "live" || status === "awaiting_approval";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.1em] ${cls.text}`}>
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        {animated && <span className={`ping absolute inset-0 rounded-full ${cls.dot}`} />}
        <span className={`relative h-1.5 w-1.5 rounded-full ${cls.dot}`} />
      </span>
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}
