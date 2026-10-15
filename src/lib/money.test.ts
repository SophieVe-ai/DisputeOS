import { describe, expect, it } from "vitest";
import { fixedCompensationPence, statutoryInterestPence, statutoryRatePercent } from "./interest";
import { addDays, daysBetween, formatPence, parsePounds } from "./money";

describe("money", () => {
  it("parses pound strings into integer pence", () => {
    expect(parsePounds("£1,234.56")).toBe(123_456);
    expect(parsePounds("40")).toBe(4_000);
    expect(parsePounds("£3.9")).toBe(390);
    expect(parsePounds("-£5.00")).toBe(-500);
    expect(parsePounds("abc")).toBeNull();
  });

  it("formats pence as GBP", () => {
    expect(formatPence(1_292_000)).toBe("£12,920.00");
  });

  it("computes day differences and offsets", () => {
    expect(daysBetween("2026-07-05", "2026-10-15")).toBe(102);
    expect(addDays("2026-10-15", 14)).toBe("2026-10-29");
    expect(daysBetween("bad", "2026-01-01")).toBe(0);
  });
});

describe("Late Payment of Commercial Debts (Interest) Act 1998", () => {
  it("applies base rate + 8%", () => {
    expect(statutoryRatePercent(4)).toBe(12);
  });

  it("computes simple daily interest", () => {
    // £10,000 at 12% for 365 days = £1,200
    expect(statutoryInterestPence(1_000_000, 365, 4)).toBe(120_000);
    expect(statutoryInterestPence(1_000_000, 0, 4)).toBe(0);
    expect(statutoryInterestPence(0, 30, 4)).toBe(0);
  });

  it("returns the correct fixed compensation band", () => {
    expect(fixedCompensationPence(99_999)).toBe(4_000);
    expect(fixedCompensationPence(100_000)).toBe(7_000);
    expect(fixedCompensationPence(999_999)).toBe(7_000);
    expect(fixedCompensationPence(1_000_000)).toBe(10_000);
    expect(fixedCompensationPence(0)).toBe(0);
  });
});
