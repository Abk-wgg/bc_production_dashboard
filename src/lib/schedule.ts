// Shaping orders into the schedule: one day at a time, split into work-centre
// columns. Pure functions - no BC access.

import type { OrderWithWorkCenter } from "./types";
import { categorise, centersOf, type WorkCenterCategory } from "./work-center";

export const NO_DATE = "not-scheduled";

export type DayGroup<T extends OrderWithWorkCenter = OrderWithWorkCenter> = {
  /**
   * The scheduled start date as YYYY-MM-DD, or NO_DATE for orders with no
   * routing line to take one from.
   */
  key: string;
  orders: T[];
};

/**
 * Group by the day the work is scheduled to START, earliest first, with
 * unscheduled orders last.
 *
 * Deliberately not the due date. A schedule answers "what runs today"; the due
 * date answers "what is owed today". Grouping by due date puts a job that runs
 * next week in whatever month it happens to be promised for, which is not where
 * anyone looks for it. The due date is still shown on every card.
 */
export function groupByDay<T extends OrderWithWorkCenter>(orders: T[]): DayGroup<T>[] {
  const byDay = new Map<string, T[]>();

  for (const order of orders) {
    const key = order.scheduledStart ?? NO_DATE;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(order);
  }

  return [...byDay.entries()]
    .map(([key, group]) => ({ key, orders: group }))
    .sort((a, b) => {
      if (a.key === NO_DATE) return 1;
      if (b.key === NO_DATE) return -1;
      return a.key < b.key ? -1 : 1;
    });
}

/**
 * Which day the board should open on: today, or the next day that has work.
 *
 * Not the earliest day in the data. On real data that is a single stalled order
 * from five months back - day 1 of 57, fifty clicks from the day the person
 * actually came to look at. Landing on today hides nothing, because Previous
 * still walks back through the entire backlog; it just starts you where the
 * question "what runs today" is answered.
 *
 * If every day is in the past, open on the most recent one rather than the
 * oldest - same reasoning. Unscheduled orders (NO_DATE) are never a landing
 * place, since they sort last and answer a different question.
 */
export function initialDayIndex(days: { key: string }[], asOf: string): number {
  let lastDated = -1;

  for (let i = 0; i < days.length; i++) {
    if (days[i].key === NO_DATE) continue;
    // Days are sorted ascending, so the first one at or after today is the one.
    if (days[i].key >= asOf) return i;
    lastDated = i;
  }

  return lastDated === -1 ? 0 : lastDated;
}

export type WorkCenterColumn<T extends OrderWithWorkCenter = OrderWithWorkCenter> = {
  workCenter: string;
  category: WorkCenterCategory;
  orders: T[];
};

// Production centres first, then bought-in/trade, then anything with no
// routing line at all - which is the group that needs chasing, so it stays
// visible at the end rather than being dropped.
const CATEGORY_ORDER: Record<WorkCenterCategory, number> = {
  production: 0,
  trade: 1,
  unassigned: 2,
};

/**
 * Every work centre present, in the order the columns appear.
 *
 * Taken across ALL the orders passed in, not one day's, so the filter chips do
 * not appear and vanish as you page through days - a control that rearranges
 * itself under the cursor is unusable.
 */
export function workCentersIn(orders: Pick<OrderWithWorkCenter, "workCenter">[]): string[] {
  const centres = new Set<string>();
  for (const order of orders) {
    for (const centre of centersOf(order.workCenter)) centres.add(centre);
  }
  return [...centres].sort(byColumnOrder);
}

function byColumnOrder(a: string, b: string): number {
  const byCategory = CATEGORY_ORDER[categorise(a)] - CATEGORY_ORDER[categorise(b)];
  if (byCategory !== 0) return byCategory;
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Split one day's orders into work-centre columns, dropping any centre the
 * viewer has hidden.
 *
 * An order that spans two centres appears in both - it genuinely needs both,
 * and hiding it from one would misrepresent that centre's day. By the same
 * logic, hiding one centre does not remove such an order from the other.
 */
export function toWorkCenterColumns<T extends OrderWithWorkCenter>(
  orders: T[],
  hidden: Set<string> = new Set(),
): WorkCenterColumn<T>[] {
  const byCentre = new Map<string, T[]>();

  for (const order of orders) {
    for (const centre of centersOf(order.workCenter)) {
      if (hidden.has(centre)) continue;
      if (!byCentre.has(centre)) byCentre.set(centre, []);
      byCentre.get(centre)!.push(order);
    }
  }

  return [...byCentre.entries()]
    .map(([workCenter, group]) => ({
      workCenter,
      category: categorise(workCenter),
      orders: [...group].sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true })),
    }))
    // Same comparator as the filter chips, so a centre sits in the same place
    // in both and the eye can move between them without re-reading.
    .sort((a, b) => byColumnOrder(a.workCenter, b.workCenter));
}

/** Distinct location codes present, sorted - drives the colour assignment. */
export function locationsIn(orders: Pick<OrderWithWorkCenter, "locationCode">[]): string[] {
  const set = new Set<string>();
  for (const order of orders) {
    if (order.locationCode) set.add(order.locationCode);
  }
  return [...set].sort();
}
