// One row per vendor per week, built from the same component lines the
// Component list groups by order.
//
// Two pages, one dataset, two questions. "Can this order run" is answered by
// grouping the lines by order. "What do I owe this supplier, and when" is
// answered by grouping the same lines by who supplies the item and the week
// the work runs. Neither is a view of the other, and both are the truth.
//
// The week comes from the parent order's PLANNED START, not the component's
// own Due Date. Those agree on 1,923 of 1,957 lines, but the schedule groups
// on planned start, and a purchasing page that disagreed with the schedule
// about which week a job runs in would be worse than no page.
//
// Pure - no BC access, no React.

import type { BoardComponent } from "./types";
import { isShort, shortfallOf } from "./component-groups";
import { mondayOf, weekNumber } from "./weeks";

/**
 * Where an unattributed line goes.
 *
 * 8% of lines are on items with no Vendor No. set in BC. They are a row, not a
 * silent gap: a component nobody is recorded as supplying is a purchasing
 * problem, and hiding it would be the one thing this page must not do.
 */
export const NO_VENDOR = "";

/** A component line with its supplier and week resolved. */
export type VendorLine = BoardComponent & {
  /** "" when the item carries no Vendor No. */
  vendorNo: string;
  /** Falls back to the code when no vendor card is available. */
  vendorName: string;
  /** Monday of the week the parent order is planned to start. "" if unknown. */
  weekStart: string;
};

/** A quantity and the unit it is counted in. */
export type UnitTotal = { code: string; quantity: number };

export type VendorWeek = {
  /** Stable row identity - a vendor appears once per week, never twice. */
  key: string;
  vendorNo: string;
  vendorName: string;
  weekStart: string;
  weekNo: number;
  /** The lines themselves, for the panel behind the row. */
  lines: VendorLine[];
  lineCount: number;
  /** Distinct production orders and items across those lines. */
  orderCount: number;
  itemCount: number;
  /**
   * Remaining, summed. Only meaningful when `units` holds one entry - see it.
   * Kept as a single number because it is what the column sorts on.
   */
  remaining: number;
  /**
   * Remaining split by unit of measure, biggest first.
   *
   * Because a bare total is a lie when a vendor supplies in more than one
   * unit. 82 of 83 vendor-weeks use a single unit and read "12,681.926 (KG)";
   * the one that does not is 94,500 EACH plus 1,047 KG, which the plain sum
   * reported as 95,547 of nothing in particular.
   */
  units: UnitTotal[];
  picked: number;
  pickedLines: number;
  fullyPicked: boolean;
  shortLines: number;
  shortBy: number;
  /** The first day in the week anything is needed. */
  earliestNeeded: string | null;
  /** When the first of the missing material lands. Short lines only. */
  nextReceipt: string | null;
};

/** The earlier of two ISO dates, ignoring blanks. */
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Attach a supplier and a week to each line.
 *
 * `startOf` is the parent order's planned start, from the routing lines - the
 * same map the schedule builds. Where an order has no routing line to take one
 * from, the component's own Due Date stands in rather than dropping the line:
 * a line with no week would vanish from a page whose whole axis is weeks.
 */
export function toVendorLines(
  lines: BoardComponent[],
  vendorOf: ReadonlyMap<string, string>,
  nameOf: ReadonlyMap<string, string>,
  startOf: ReadonlyMap<string, string>,
): VendorLine[] {
  return lines.map((line) => {
    const vendorNo = vendorOf.get(line.itemNo) ?? NO_VENDOR;
    const start = startOf.get(line.prodOrderNo) ?? line.dueDate ?? "";
    return {
      ...line,
      vendorNo,
      // A code with no card behind it still names the supplier well enough to
      // act on. Showing a blank because the vendor list is missing would lose
      // information the line already carries.
      vendorName: nameOf.get(vendorNo) || vendorNo,
      weekStart: mondayOf(start),
    };
  });
}

/**
 * Group into one row per vendor per week.
 *
 * Sorted by week, then by the biggest commitment first - a buyer opening the
 * page is looking at what to chase, and the vendor with 300 lines this week is
 * that, not whoever sorts first alphabetically.
 *
 * `stockKnown` is false when the stock feed is partial. An item with no stock
 * row is then unknown rather than absent, so nothing may be called short.
 */
export function groupByVendorWeek(
  lines: VendorLine[],
  stockKnown: boolean,
): VendorWeek[] {
  const byKey = new Map<string, VendorWeek>();
  // Tracked outside the row so the counts stay distinct counts, not sums.
  const orders = new Map<string, Set<string>>();
  const items = new Map<string, Set<string>>();
  const units = new Map<string, Map<string, number>>();

  for (const line of lines) {
    const key = `${line.vendorNo}|${line.weekStart}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        vendorNo: line.vendorNo,
        vendorName: line.vendorName,
        weekStart: line.weekStart,
        weekNo: weekNumber(line.weekStart),
        lines: [],
        lineCount: 0,
        orderCount: 0,
        itemCount: 0,
        remaining: 0,
        units: [],
        picked: 0,
        pickedLines: 0,
        fullyPicked: true,
        shortLines: 0,
        shortBy: 0,
        earliestNeeded: null,
        nextReceipt: null,
      };
      byKey.set(key, group);
      orders.set(key, new Set());
      items.set(key, new Set());
      units.set(key, new Map());
    }

    group.lines.push(line);
    group.lineCount += 1;
    group.remaining += line.remainingQuantity;
    group.picked += line.qtyPicked;
    if (line.completelyPicked) group.pickedLines += 1;
    else group.fullyPicked = false;

    orders.get(key)!.add(line.prodOrderNo);
    items.get(key)!.add(line.itemNo);

    const code = line.unitOfMeasureCode || "?";
    const perUnit = units.get(key)!;
    perUnit.set(code, (perUnit.get(code) ?? 0) + line.remainingQuantity);

    group.earliestNeeded = earliest(group.earliestNeeded, line.dueDate);

    if (stockKnown && isShort(line)) {
      group.shortLines += 1;
      group.shortBy += shortfallOf(line);
      // Same rule as the order grouping: only a short line's delivery is news.
      // A covered line has an incoming PO too, and showing its date would read
      // as waiting on a delivery when nothing is being waited on.
      group.nextReceipt = earliest(group.nextReceipt, line.nextReceipt);
    }
  }

  for (const [key, group] of byKey) {
    group.orderCount = orders.get(key)!.size;
    group.itemCount = items.get(key)!.size;
    group.units = [...units.get(key)!.entries()]
      .map(([code, quantity]) => ({ code, quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code));
  }

  return [...byKey.values()].sort((a, b) => {
    // Undated last - it answers a different question from any real week.
    if (a.weekStart !== b.weekStart) {
      if (!a.weekStart) return 1;
      if (!b.weekStart) return -1;
      return a.weekStart < b.weekStart ? -1 : 1;
    }
    if (a.lineCount !== b.lineCount) return b.lineCount - a.lineCount;
    return a.vendorName.localeCompare(b.vendorName, undefined, { sensitivity: "base" });
  });
}

/** Distinct vendors across the rows, for the filter dropdown. */
export function vendorsIn(rows: VendorWeek[]): { no: string; name: string; lines: number }[] {
  const byVendor = new Map<string, { no: string; name: string; lines: number }>();
  for (const row of rows) {
    const hit = byVendor.get(row.vendorNo);
    if (hit) hit.lines += row.lineCount;
    else byVendor.set(row.vendorNo, { no: row.vendorNo, name: row.vendorName, lines: row.lineCount });
  }
  return [...byVendor.values()].sort((a, b) => b.lines - a.lines);
}

/**
 * Every week present, earliest first, undated last.
 *
 * Built from ALL the lines rather than the filtered ones, so the week pager
 * does not gain and lose weeks as filters are toggled - a control that
 * rearranges itself under the cursor is unusable. Same reasoning as the
 * schedule's work-centre list.
 */
export function weeksIn(lines: VendorLine[]): string[] {
  const weeks = new Set<string>();
  for (const line of lines) weeks.add(line.weekStart);
  return [...weeks].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a < b ? -1 : 1;
  });
}
