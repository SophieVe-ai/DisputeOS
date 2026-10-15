// Reconciliation agent: deterministic by design — money arithmetic is never delegated to an LLM.
// Compares contract prices, invoiced quantities/prices, delivered quantities and payments.
import { addDays, daysBetween, formatPence } from "../money";
import { fixedCompensationPence, statutoryInterestPence } from "../interest";
import type { ExtractedFacts, ReconciliationLine, ReconciliationOutput } from "../types";
import { requirePrior, type Agent } from "./context";

const DEFAULT_PAYMENT_TERMS_DAYS = 30;

export function normaliseItem(item: string): string {
  return item.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sumBy<T>(list: T[], fn: (t: T) => number): number {
  return list.reduce((s, t) => s + fn(t), 0);
}

export function reconcileLines(facts: ExtractedFacts): ReconciliationLine[] {
  const hasDeliveries = facts.deliveries.length > 0;
  // Keyed by item AND unit price so the same item invoiced at two prices is reconciled separately.
  const byItem = new Map<string, { key: string; item: string; qty: number; unit: number; pence: number }>();
  for (const line of facts.invoices.flatMap((i) => i.lines)) {
    const key = normaliseItem(line.item);
    const mapKey = `${key}|${line.unitPricePence}`;
    const prev = byItem.get(mapKey);
    byItem.set(mapKey, {
      key,
      item: prev?.item ?? line.item,
      qty: (prev?.qty ?? 0) + line.qty,
      unit: line.unitPricePence,
      pence: (prev?.pence ?? 0) + line.qty * line.unitPricePence,
    });
  }
  const deliveredByItem = new Map<string, number>();
  for (const l of facts.deliveries.flatMap((d) => d.lines)) {
    const key = normaliseItem(l.item);
    deliveredByItem.set(key, (deliveredByItem.get(key) ?? 0) + l.qty);
  }
  return [...byItem.values()].map((inv) => {
    const key = inv.key;
    const contractLine = facts.contract?.lines.find((l) => normaliseItem(l.item) === key);
    const contractUnit = contractLine?.unitPricePence ?? null;
    // Deliveries are consumed across price lines of the same item so they are never double-counted.
    const delivered = deliveredByItem.get(key) ?? 0;
    deliveredByItem.set(key, Math.max(0, delivered - inv.qty));
    const fairUnit = contractUnit === null ? inv.unit : Math.min(inv.unit, contractUnit);
    const supportedQty = hasDeliveries ? Math.min(inv.qty, delivered) : inv.qty;
    const supported = supportedQty * fairUnit;
    const flags: string[] = [];
    if (contractUnit !== null && inv.unit > contractUnit) {
      flags.push(`Invoiced at ${formatPence(inv.unit)} vs contract ${formatPence(contractUnit)}`);
    }
    if (contractUnit === null && facts.contract) flags.push("Item not priced in contract");
    if (hasDeliveries && delivered < inv.qty) flags.push(`Invoiced ${inv.qty} but only ${delivered} delivered`);
    if (!hasDeliveries) flags.push("No delivery record to confirm quantity");
    return {
      item: inv.item,
      contractUnitPence: contractUnit,
      invoicedQty: inv.qty,
      invoicedUnitPence: inv.unit,
      deliveredQty: hasDeliveries ? delivered : 0,
      invoicedPence: inv.pence,
      supportedPence: supported,
      variancePence: inv.pence - supported,
      flags,
    };
  });
}

export function earliestDueDate(facts: ExtractedFacts): string | null {
  const terms = facts.contract?.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS;
  const dues = facts.invoices
    .map((i) => i.dueDate ?? (i.date ? addDays(i.date, terms) : null))
    .filter((d): d is string => d !== null)
    .sort();
  return dues[0] ?? null;
}

export interface DebtTranche {
  dueDate: string | null;
  principalPence: number;
}

/**
 * Splits a principal across invoices: payments are applied oldest invoice first, and the
 * principal is then allocated pro rata to each invoice's remaining balance. Interest and
 * fixed compensation are computed per invoice on the debt actually owed, from its own due date.
 */
export function allocateDebt(facts: ExtractedFacts, principalPence: number): DebtTranche[] {
  const terms = facts.contract?.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS;
  const invoices = [...facts.invoices]
    .map((i) => ({ due: i.dueDate ?? (i.date ? addDays(i.date, terms) : null), total: i.totalPence }))
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  let unapplied = sumBy(facts.payments, (p) => p.amountPence);
  const balances = invoices.map((i) => {
    const applied = Math.min(i.total, unapplied);
    unapplied -= applied;
    return { due: i.due, balance: i.total - applied };
  });
  const totalBalance = sumBy(balances, (b) => b.balance);
  if (totalBalance <= 0 || principalPence <= 0) return [];
  let remaining = principalPence;
  return balances.map((b, idx) => {
    const share = idx === balances.length - 1 ? remaining : Math.round((principalPence * b.balance) / totalBalance);
    remaining -= share;
    return { dueDate: b.due, principalPence: share };
  });
}

export function interestSchedule(
  facts: ExtractedFacts,
  principalPence: number,
  asOf: string,
  baseRatePercent: number,
): { interestPence: number; compensationPence: number } {
  const tranches = allocateDebt(facts, principalPence).filter((t) => t.principalPence > 0 && t.dueDate);
  const overdue = tranches.map((t) => ({ ...t, days: Math.max(0, daysBetween(t.dueDate!, asOf)) })).filter((t) => t.days > 0);
  return {
    interestPence: sumBy(overdue, (t) => statutoryInterestPence(t.principalPence, t.days, baseRatePercent)),
    compensationPence: sumBy(overdue, (t) => fixedCompensationPence(t.principalPence)),
  };
}

export function reconcile(facts: ExtractedFacts, asOf: string, baseRatePercent: number): ReconciliationOutput {
  const lines = reconcileLines(facts);
  const lineTotal = sumBy(lines, (l) => l.invoicedPence);
  const statedTotal = sumBy(facts.invoices, (i) => i.totalPence);
  const paid = sumBy(facts.payments, (p) => p.amountPence);
  const supportedGross = sumBy(lines, (l) => l.supportedPence);
  const overcharge = sumBy(lines, (l) =>
    l.contractUnitPence !== null && l.invoicedUnitPence > l.contractUnitPence
      ? (l.invoicedUnitPence - l.contractUnitPence) * l.invoicedQty
      : 0,
  );
  const shortDelivery = lineTotal - supportedGross - overcharge;
  const supportedPrincipal = Math.max(0, supportedGross - paid);
  const due = earliestDueDate(facts);
  const daysOverdue = due ? Math.max(0, daysBetween(due, asOf)) : 0;
  const { interestPence: interest, compensationPence: compensation } = interestSchedule(facts, supportedPrincipal, asOf, baseRatePercent);
  const notes: string[] = [];
  if (statedTotal !== lineTotal) {
    notes.push(`Invoice totals state ${formatPence(statedTotal)} but line items sum to ${formatPence(lineTotal)}.`);
  }
  const summary =
    `Invoiced ${formatPence(lineTotal)}, paid ${formatPence(paid)}, outstanding ${formatPence(lineTotal - paid)}. ` +
    `Evidence supports ${formatPence(supportedPrincipal)} principal` +
    (overcharge > 0 ? `, after removing ${formatPence(overcharge)} invoiced above contract price` : "") +
    (shortDelivery > 0 ? ` and ${formatPence(shortDelivery)} for goods not delivered` : "") +
    `. ${daysOverdue} days overdue. ${notes.join(" ")}`.trim();
  return {
    summary,
    lines,
    invoicedTotalPence: lineTotal,
    paidPence: paid,
    outstandingPence: lineTotal - paid,
    supportedPrincipalPence: supportedPrincipal,
    overchargePence: overcharge,
    shortDeliveryPence: Math.max(0, shortDelivery),
    daysOverdue,
    interestPence: interest,
    compensationPence: compensation,
    totalRecoverablePence: supportedPrincipal + interest + compensation,
  };
}

export const reconciliationAgent: Agent<ReconciliationOutput> = {
  name: "reconciliation",
  title: "Reconciliation agent",
  async run(ctx) {
    const evidence = requirePrior(ctx, "evidence");
    ctx.log("reconciliation.started", { invoices: evidence.facts.invoices.length });
    const output = reconcile(evidence.facts, ctx.asOf, ctx.baseRatePercent);
    for (const line of output.lines) {
      await ctx.pace(0.3);
      ctx.log("reconciliation.line_checked", {
        item: line.item,
        invoicedPence: line.invoicedPence,
        supportedPence: line.supportedPence,
        flags: line.flags,
      });
    }
    return { output, engine: "deterministic" };
  },
};
