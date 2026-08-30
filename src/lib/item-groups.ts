// One row per item, built from a vendor's component lines for a week.
//
// A buyer opening a supplier for a week is about to write a purchase order, and
// a purchase order has one line per item, not one per production order. Four
// orders each needing 143 KG of the same liquid is one line of 572 KG to the
// vendor; which orders it is for is the follow-up question, so it sits behind
// the row.
//
// Pure - no BC access, no React.

import type { VendorLine } from "./vendor-weeks";

export type ItemDemand = {
  itemNo: string;
  description: string;
  unitOfMeasureCode: string;
  /** The lines behind the row - one per production order line. */
  lines: VendorLine[];
  orderCount: number;
  /** Summed across the lines. This is the quantity to buy. */
  remaining: number;
  picked: number;
  pickedLines: number;
  /**
   * Free stock for the item.
   *
   * Taken ONCE, never summed. Every line of the same item carries the same
   * figure, because it is the item's stock and not the line's share of it -
   * adding it up across four lines would report four times the shelf.
   */
  available: number;
  /**
   * Demand this week beyond what is on the shelf, for the item as a whole.
   *
   * This is the honest question and the per-line one is not: line by line,
   * each of four orders needing 143 KG sees the same 150 KG of stock and
   * decides it is covered, so nothing looks short while the week is 422 KG
   * down. Compared once against one pool, it is short.
   */
  shortBy: number;
  earliestNeeded: string | null;
  nextReceipt: string | null;
};

/** The earlier of two ISO dates, ignoring blanks. */
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Group a vendor-week's lines into items.
 *
 * Short items lead, then the biggest quantity, then item number. The first two
 * are what needs acting on; the last keeps related codes together
 * (RTV-09378.1 beside RTV-09378.2) once nothing is urgent.
 *
 * `stockKnown` is false when the stock feed is partial. An item with no stock
 * row is then unknown rather than absent, so nothing may be called short.
 */
export function groupLinesByItem(lines: VendorLine[], stockKnown: boolean): ItemDemand[] {
  const byItem = new Map<string, ItemDemand>();
  const orders = new Map<string, Set<string>>();

  for (const line of lines) {
    let group = byItem.get(line.itemNo);
    if (!group) {
      group = {
        itemNo: line.itemNo,
        description: line.description,
        unitOfMeasureCode: line.unitOfMeasureCode,
        lines: [],
        orderCount: 0,
        remaining: 0,
        picked: 0,
        pickedLines: 0,
        available: line.available,
        shortBy: 0,
        earliestNeeded: null,
        nextReceipt: null,
      };
      byItem.set(line.itemNo, group);
      orders.set(line.itemNo, new Set());
    }

    group.lines.push(line);
    group.remaining += line.remainingQuantity;
    group.picked += line.qtyPicked;
    if (line.completelyPicked) group.pickedLines += 1;
    orders.get(line.itemNo)!.add(line.prodOrderNo);

    // Not `+=`. See the note on the field.
    group.available = Math.max(group.available, line.available);
    group.earliestNeeded = earliest(group.earliestNeeded, line.dueDate);
    group.nextReceipt = earliest(group.nextReceipt, line.nextReceipt);
  }

  for (const [itemNo, group] of byItem) {
    group.orderCount = orders.get(itemNo)!.size;
    group.shortBy = stockKnown ? Math.max(0, group.remaining - group.available) : 0;
    // A delivery is only news when something is missing. An item already on the
    // shelf may still have an incoming PO, and showing its date would read as
    // waiting on a delivery when nothing is being waited on.
    if (group.shortBy === 0) group.nextReceipt = null;
  }

  return [...byItem.values()].sort(
    (a, b) =>
      (b.shortBy > 0 ? 1 : 0) - (a.shortBy > 0 ? 1 : 0) ||
      b.remaining - a.remaining ||
      a.itemNo.localeCompare(b.itemNo, undefined, { numeric: true, sensitivity: "base" }),
  );
}
