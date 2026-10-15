// Late Payment of Commercial Debts (Interest) Act 1998.
// Statutory interest = 8% above the Bank of England reference (base) rate, simple, daily.
// Fixed compensation per invoice: <£1,000 → £40; £1,000–£9,999.99 → £70; ≥£10,000 → £100.

export const STATUTORY_UPLIFT_PERCENT = 8;

const COMPENSATION_BANDS = [
  { belowPence: 100_000, compensationPence: 4_000 },
  { belowPence: 1_000_000, compensationPence: 7_000 },
  { belowPence: Number.POSITIVE_INFINITY, compensationPence: 10_000 },
] as const;

export function fixedCompensationPence(debtPence: number): number {
  if (debtPence <= 0) return 0;
  const band = COMPENSATION_BANDS.find((b) => debtPence < b.belowPence);
  return band ? band.compensationPence : 0;
}

export function statutoryRatePercent(baseRatePercent: number): number {
  return baseRatePercent + STATUTORY_UPLIFT_PERCENT;
}

export function statutoryInterestPence(
  principalPence: number,
  daysOverdue: number,
  baseRatePercent: number,
): number {
  if (principalPence <= 0 || daysOverdue <= 0) return 0;
  const annual = statutoryRatePercent(baseRatePercent) / 100;
  return Math.round((principalPence * annual * daysOverdue) / 365);
}

export function dailyInterestPence(
  principalPence: number,
  baseRatePercent: number,
): number {
  return (principalPence * (statutoryRatePercent(baseRatePercent) / 100)) / 365;
}
