// Shaping orders into the schedule: one day at a time, split into work-centre
// columns. Pure functions - no BC access.

import type { OrderWithWorkCenter } from "./types";
import {
  UNASSIGNED,
  categorise,
  splitWorkCenters,
  type WorkCenterCategory,
} from "./work-center";

export const NO_DATE = "no-date";

export type DayGroup = {
  /** The due date as YYYY-MM-DD, or NO_DATE for orders with no due date. */
  key: string;
  orders: OrderWithWorkCenter[];
};

/** Group by due date, earliest first, with undated orders last. */
export function groupByDay(orders: OrderWithWorkCenter[]): DayGroup[] {
  const byDay = new Map<string, OrderWithWorkCenter[]>();

  for (const order of orders) {
    const key = order.dueDate ?? NO_DATE;
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

export type WorkCenterColumn = {
  workCenter: string;
  category: WorkCenterCategory;
  orders: OrderWithWorkCenter[];
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
 * Split one day's orders into work-centre columns. An order that spans two
 * centres appears in both - it genuinely needs both, and hiding it from one
 * would misrepresent that centre's day.
 */
export function toWorkCenterColumns(
  orders: OrderWithWorkCenter[],
  category: Exclude<WorkCenterCategory, "unassigned"> | null,
): WorkCenterColumn[] {
  const byCentre = new Map<string, OrderWithWorkCenter[]>();

  for (const order of orders) {
    const centres = splitWorkCenters(order.workCenter);
    const keys = centres.length > 0 ? centres : [UNASSIGNED];
    for (const centre of keys) {
      if (category && categorise(centre) !== category) continue;
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
    .sort((a, b) => {
      const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
      if (byCategory !== 0) return byCategory;
      return a.workCenter.localeCompare(b.workCenter, undefined, { numeric: true });
    });
}

/** Distinct location codes present, sorted - drives the colour assignment. */
export function locationsIn(orders: OrderWithWorkCenter[]): string[] {
  const set = new Set<string>();
  for (const order of orders) {
    if (order.locationCode) set.add(order.locationCode);
  }
  return [...set].sort();
}
