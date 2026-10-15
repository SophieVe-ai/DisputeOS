const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
export const money = (pence: number | null | undefined) => (pence == null ? "—" : GBP.format(pence / 100));
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
export const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");
export const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
export const humanise = (s: string) => s.replace(/_/g, " ");
