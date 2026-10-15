const STYLES: Record<string, { icon: string; cls: string }> = {
  open: { icon: "○", cls: "border-line text-ink-2" },
  in_review: { icon: "◐", cls: "border-info/40 text-info" },
  queued: { icon: "…", cls: "border-info/40 text-info" },
  running: { icon: "◐", cls: "border-info/40 text-info" },
  awaiting_approval: { icon: "⏸", cls: "border-warn/40 text-warn" },
  pending: { icon: "⏸", cls: "border-warn/40 text-warn" },
  approved: { icon: "✓", cls: "border-good/40 text-good" },
  executed: { icon: "✓", cls: "border-good/40 text-good" },
  resolved: { icon: "✓", cls: "border-good/40 text-good" },
  completed: { icon: "✓", cls: "border-good/40 text-good" },
  done: { icon: "✓", cls: "border-good/40 text-good" },
  anchored: { icon: "⛓", cls: "border-good/40 text-good" },
  match: { icon: "✓", cls: "border-good/40 text-good" },
  upheld: { icon: "!", cls: "border-warn/40 text-warn" },
  partially_upheld: { icon: "◑", cls: "border-warn/40 text-warn" },
  rebutted: { icon: "✕", cls: "border-good/40 text-good" },
  rejected: { icon: "✕", cls: "border-bad/40 text-bad" },
  failed: { icon: "✕", cls: "border-bad/40 text-bad" },
  error: { icon: "✕", cls: "border-bad/40 text-bad" },
  mismatch: { icon: "✕", cls: "border-bad/40 text-bad" },
  missing: { icon: "?", cls: "border-warn/40 text-warn" },
  unavailable: { icon: "–", cls: "border-line text-ink-3" },
  closed: { icon: "■", cls: "border-line text-ink-3" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STYLES[status] ?? { icon: "•", cls: "border-line text-ink-2" };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}
