"use client";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const COUNT_DURATION_MS = 1100;
const SCRAMBLE_DURATION_MS = 650;
const HEX = "0123456789abcdef";

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches, () => false);
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Animates from the previously displayed value to `target` whenever it changes. */
export function useCountUp(target: number | null | undefined, duration = COUNT_DURATION_MS): number | null {
  const reduced = useReducedMotion();
  const [value, setValue] = useState<number | null>(null);
  const shown = useRef(0);

  useEffect(() => {
    if (target == null) return;
    const from = shown.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = reduced ? 1 : Math.min((now - start) / duration, 1);
      const next = from + (target - from) * easeOutExpo(t);
      shown.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduced]);

  return target == null ? null : value;
}

export function CountUp({ value, format, fallback = "—" }: { value: number | null | undefined; format: (n: number) => string; fallback?: string }) {
  const n = useCountUp(value);
  return <span className="tabular-nums">{n == null ? fallback : format(n)}</span>;
}

/** Decodes text from random hex glyphs into its final value — used for hashes as they arrive. */
export function Scramble({ text, className, duration = SCRAMBLE_DURATION_MS }: { text: string; className?: string; duration?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (reduced) {
      const frame = requestAnimationFrame(() => setShown(text));
      return () => cancelAnimationFrame(frame);
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const settled = Math.floor(text.length * t);
      let out = text.slice(0, settled);
      for (let i = settled; i < text.length; i++) {
        const ch = text[i];
        out += /[0-9a-fx]/i.test(ch) && i > 1 ? HEX[Math.floor(Math.random() * HEX.length)] : ch;
      }
      setShown(out);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, duration, reduced]);

  return <span className={className} title={text}>{shown}</span>;
}

/** Splits a headline into words that rise in sequence. */
export function WordReveal({ children, delayMs = 0, stepMs = 45 }: { children: string; delayMs?: number; stepMs?: number }) {
  return (
    <>
      {children.split(" ").map((word, i) => (
        <Fragment key={i}>
          <span className="word" style={{ animationDelay: `${delayMs + i * stepMs}ms` }}>{word}</span>{" "}
        </Fragment>
      ))}
    </>
  );
}

export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "header" }) {
  const style: CSSProperties = { animationDelay: `${delay}ms` };
  return <Tag className={`reveal ${className}`} style={style}>{children}</Tag>;
}
