// One row per production order, built from its component lines.
//
// The component list used to be 1,957 flat lines, which is the shape BC hands
// over but not the shape anyone reads. Nobody picks "a component line" - they
// pick an order, and the question in front of them is "can this one run".
// So the table is grouped and the lines live behind it.
//
// Grouping happens after the line filters, not before: filter to short lines
// and you get the orders that have short lines, each showing only those. What
// the row counts and what the panel lists are then always the same set.
//
// Pure - no BC access, no React.

import type { BoardComponent } from "./types";

export type OrderComponents = {
  prodOrderNo: string;
  locationCode: string;
  workCenter: string;
  /** The day the material has to be at the line - the parent's planned start. */
  neededDate: string | null;
  /** The lines themselves, for the panel. */
  lines: BoardComponent[];
  lineCount: number;
  /** Summed across the lines. */
  remaining: number;
  picked: number;
  /** How many lines BC calls Completely Picked, and whether that is all of them. */
  pickedLines: number;
  fullyPicked: boolean;
  /** Lines without enough free stock, and the total shortfall across them. */
  shortLines: number;
  shortBy: number;
  /** When the first of the missing material lands. Only short lines count. */
  nextReceipt: string | null;
  earliestExpiry: string | null;
};

/** Not enough free stock to finish what is left of the line. */
export function isShort(line: BoardComponent): boolean {
  return line.remainingQuantity > 0 && line.available < line.remainingQuantity;
}

export function shortfallOf(line: BoardComponent): number {
  return isShort(line) ? line.remainingQuantity - line.available : 0;
}

/** The earlier of two ISO dates, ignoring blanks. */
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Group lines into orders, in production order number order.
 *
 * `stockKnown` is false when the stock feed is partial. An item with no stock
 * row is then unknown rather than absent, so nothing may be called short -
 * flagging it would put a red warning on nearly every order for no reason.
 */
export function groupByOrder(
  lines: BoardComponent[],
  stockKnown: boolean,
): OrderComponents[] {
  const byOrder = new Map<string, OrderComponents>();

  for (const line of lines) {
    let group = byOrder.get(line.prodOrderNo);
    if (!group) {
      group = {
        prodOrderNo: line.prodOrderNo,
        locationCode: line.locationCode,
        workCenter: line.workCenter,
        neededDate: null,
        lines: [],
        lineCount: 0,
        remaining: 0,
        picked: 0,
        pickedLines: 0,
        fullyPicked: true,
        shortLines: 0,
        shortBy: 0,
        nextReceipt: null,
        earliestExpiry: null,
      };
      byOrder.set(line.prodOrderNo, group);
    }

    group.lines.push(line);
    group.lineCount += 1;
    group.remaining += line.remainingQuantity;
    group.picked += line.qtyPicked;
    if (line.completelyPicked) group.pickedLines += 1;
    else group.fullyPicked = false;

    group.neededDate = earliest(group.neededDate, line.dueDate);
    group.earliestExpiry = earliest(group.earliestExpiry, line.earliestExpiry);

    if (stockKnown && isShort(line)) {
      group.shortLines += 1;
      group.shortBy += shortfallOf(line);
      // Only a short line's delivery is news. A line with the stock already on
      // the shelf has an incoming PO too, and showing that date would read as
      // "waiting on a delivery" when nothing is being waited on.
      group.nextReceipt = earliest(group.nextReceipt, line.nextReceipt);
    }
  }

  // An order with no lines at all cannot exist here, so every group has at
  // least one line and `fullyPicked` is never vacuously true.
  return [...byOrder.values()].sort((a, b) =>
    a.prodOrderNo.localeCompare(b.prodOrderNo, undefined, { numeric: true, sensitivity: "base" }),
  );
}
