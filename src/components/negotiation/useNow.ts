"use client";
import { useEffect, useState } from "react";

/** Current time, refreshed every `intervalMs`. Null until mounted, so render stays pure. */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

const UNITS: [number, string][] = [[86_400_000, "d"], [3_600_000, "h"], [60_000, "m"], [1000, "s"]];

/** "in 13d 4h", "in 42s", or "now". */
export function until(dueIso: string, now: number): string {
  let ms = Date.parse(dueIso) - now;
  if (ms <= 0) return "now";
  const parts: string[] = [];
  for (const [size, unit] of UNITS) {
    if (ms >= size && parts.length < 2) {
      parts.push(`${Math.floor(ms / size)}${unit}`);
      ms %= size;
    }
  }
  return `in ${parts.join(" ") || "1s"}`;
}
