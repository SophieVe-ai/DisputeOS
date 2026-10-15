const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

export function formatPence(pence: number): string {
  return GBP.format(pence / 100);
}

/** Parses "£1,234.56" / "1234.5" / "£40" into integer pence. Returns null when not numeric. */
export function parsePounds(raw: string): number | null {
  const cleaned = raw.replace(/[£,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.replace("-", "").split(".");
  const pence = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cleaned.startsWith("-") ? -pence : pence;
}

export const MS_PER_DAY = 86_400_000;

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso.slice(0, 10));
  const to = Date.parse(toIso.slice(0, 10));
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / MS_PER_DAY);
}

export function addDays(iso: string, days: number): string {
  const t = Date.parse(iso.slice(0, 10));
  return new Date(t + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
