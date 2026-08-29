// Derived values for the board. Pure functions over what the data layer
// returns - no BC access, no credentials.

import type { ProductionOrder } from "./types";
import { FINISHED } from "./status";

/** Today as YYYY-MM-DD. BC dates carry no time, so compare as plain strings. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Still to make: anything BC has not moved to Finished.
 *
 * Deliberately NOT derived from `finishedQuantity` - that field read 0 on every
 * row sampled in this tenant, so it would report the entire board as
 * outstanding regardless of reality.
 */
export function isOutstanding(order: ProductionOrder): boolean {
  return order.status !== FINISHED;
}

export function isOverdue(order: ProductionOrder, asOf: string): boolean {
  return isOutstanding(order) && order.dueDate !== null && order.dueDate < asOf;
}

export function isDueSoon(order: ProductionOrder, asOf: string, days = 7): boolean {
  if (!isOutstanding(order) || order.dueDate === null) return false;
  return order.dueDate >= asOf && order.dueDate <= addDays(asOf, days);
}

export function daysLate(order: ProductionOrder, asOf: string): number {
  if (order.dueDate === null) return 0;
  const due = Date.parse(`${order.dueDate}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  return Math.round((now - due) / 86_400_000);
}

export type Summary = {
  total: number;
  outstanding: number;
  overdue: number;
  dueSoon: number;
  unscheduled: number;
  outstandingUnits: number;
  locations: { code: string; count: number }[];
};

export function summarise(orders: ProductionOrder[], asOf: string): Summary {
  const outstanding = orders.filter(isOutstanding);

  const byLocation = new Map<string, number>();
  for (const order of outstanding) {
    const code = order.locationCode || "(none)";
    byLocation.set(code, (byLocation.get(code) ?? 0) + 1);
  }

  return {
    total: orders.length,
    outstanding: outstanding.length,
    overdue: orders.filter((o) => isOverdue(o, asOf)).length,
    dueSoon: orders.filter((o) => isDueSoon(o, asOf)).length,
    unscheduled: outstanding.filter((o) => !o.scheduled).length,
    outstandingUnits: outstanding.reduce((sum, o) => sum + o.quantity, 0),
    locations: [...byLocation.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
  };
}
