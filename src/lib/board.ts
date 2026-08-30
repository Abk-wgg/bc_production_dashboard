// Derived values for the board. Pure functions over what the data layer
// returns - no BC access, no credentials.
//
// Everything here judges an order against its PLANNED dates - `Starting Date`
// and `Ending Date` on table 5405, which is what VAPS scheduled it for. The
// due date is deliberately not used: on all 982 open orders it is simply the
// planned end plus a day (962 of them exactly one day, the rest carried over a
// weekend), so it says when the order is owed, not when it is meant to run.
// A production board answers the second question.

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

/**
 * The plan says this order should have finished by now, and it has not.
 *
 * This is the board's "late". An order with no planned end is not behind plan -
 * it has no plan to be behind.
 */
export function isBehindPlan(order: ProductionOrder, asOf: string): boolean {
  return isOutstanding(order) && order.endingDate !== null && order.endingDate < asOf;
}

/** The plan says it should have started, and it has not finished. */
export function isLateToStart(order: ProductionOrder, asOf: string): boolean {
  return isOutstanding(order) && order.startingDate !== null && order.startingDate < asOf;
}

/** Planned to start in the next `days` days - the work coming up. */
export function isStartingSoon(order: ProductionOrder, asOf: string, days = 7): boolean {
  if (!isOutstanding(order) || order.startingDate === null) return false;
  return order.startingDate >= asOf && order.startingDate <= addDays(asOf, days);
}

/** Days past the planned end. Zero when it has no planned end or is not late. */
export function daysBehindPlan(order: ProductionOrder, asOf: string): number {
  if (order.endingDate === null) return 0;
  const planned = Date.parse(`${order.endingDate}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  return Math.max(0, Math.round((now - planned) / 86_400_000));
}

export type Summary = {
  total: number;
  outstanding: number;
  behindPlan: number;
  startingSoon: number;
  /** Outstanding orders VAPS has not scheduled. */
  unscheduled: number;
  /** Outstanding orders with no planned start date at all. */
  unplanned: number;
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
    behindPlan: orders.filter((o) => isBehindPlan(o, asOf)).length,
    startingSoon: orders.filter((o) => isStartingSoon(o, asOf)).length,
    unscheduled: outstanding.filter((o) => !o.scheduled).length,
    unplanned: outstanding.filter((o) => o.startingDate === null).length,
    outstandingUnits: outstanding.reduce((sum, o) => sum + o.quantity, 0),
    locations: [...byLocation.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
  };
}
