// The joins that turn six separate feeds into one picture.
//
//   sales order → sales lines → production order → components + routing
//                                      ↓                    ↓
//                             shop-floor output      stock + incoming
//
// Pure functions over what the data layer returns. No BC access, so every rule
// here is testable without credentials.

import type {
  BoardComponent,
  ComponentLine,
  OutputEvent,
  ProdOrderComponent,
  PurchaseLine,
  SalesLine,
  SalesOrder,
  StockLot,
} from "./types";
import { OUTPUT_EVENT_TYPE, SCRAP_EVENT_TYPE } from "./scope";

// --- what actually got made -------------------------------------------------

export type OrderProgress = {
  /** Units booked as output. Net of reversals. */
  made: number;
  /** Units booked as scrap, from Scrap events only. */
  scrapped: number;
  /** Timestamp of the most recent booking, or null if nothing yet. */
  lastBookedAt: string | null;
};

/**
 * Actual output per production order, from the shop-floor event log.
 *
 * Reversals post a matching NEGATIVE row rather than deleting the original, so
 * these are plain sums - taking an absolute value would count a correction as
 * production and inflate the figure.
 *
 * Scrap is read only from `Scrap` events. Consumption rows carry a scrap
 * quantity too, but that is material scrapped while being consumed, which is a
 * different measure and would double-count if added here.
 */
export function buildProgressMap(events: OutputEvent[]): Map<string, OrderProgress> {
  const byOrder = new Map<string, OrderProgress>();

  for (const event of events) {
    const order = event.prodOrderNo;
    if (!order) continue;

    const current = byOrder.get(order) ?? { made: 0, scrapped: 0, lastBookedAt: null };

    if (event.eventType === OUTPUT_EVENT_TYPE) current.made += event.qtyOutput;
    else if (event.eventType === SCRAP_EVENT_TYPE) current.scrapped += event.qtyScrapped;
    else continue; // Start / Pause / Restart / Consumption book no quantity.

    if (event.at && (!current.lastBookedAt || event.at > current.lastBookedAt)) {
      current.lastBookedAt = event.at;
    }
    byOrder.set(order, current);
  }

  return byOrder;
}

/**
 * How far through an order is, as a fraction.
 *
 * Capped at 1 for display only - overproduction is real and the raw numbers
 * still show it, but a bar past 100% just reads as a rendering bug.
 */
export function completionOf(made: number, planned: number): number {
  if (planned <= 0) return 0;
  return Math.min(made / planned, 1);
}

// --- what is on the shelf ---------------------------------------------------

export type ItemStock = {
  onHand: number;
  available: number;
  lots: number;
  /** Earliest expiry across the lots, for the items that carry one. */
  earliestExpiry: string | null;
};

/**
 * Stock per item, summed across lots and bins.
 *
 * `available` is the figure to act on - `onHand` includes quantity already
 * committed elsewhere, so a component can look stocked and still not be usable.
 */
export function buildStockMap(lots: StockLot[]): Map<string, ItemStock> {
  const byItem = new Map<string, ItemStock>();

  for (const lot of lots) {
    if (!lot.itemNo) continue;
    const current =
      byItem.get(lot.itemNo) ?? { onHand: 0, available: 0, lots: 0, earliestExpiry: null };

    current.onHand += lot.quantity;
    current.available += lot.availableQuantity;
    current.lots += 1;
    if (lot.expiryDate && (!current.earliestExpiry || lot.expiryDate < current.earliestExpiry)) {
      current.earliestExpiry = lot.expiryDate;
    }

    byItem.set(lot.itemNo, current);
  }

  return byItem;
}

// --- what is on its way -----------------------------------------------------

export type ItemIncoming = {
  outstanding: number;
  /** Earliest date anything is expected. */
  nextReceipt: string | null;
  lines: number;
};

/**
 * Incoming stock per item.
 *
 * Matched by ITEM, not by production order: table 39 has a `Prod. Order No.`
 * field but it is empty on every row sampled, so it cannot be used to say which
 * order a delivery is for.
 *
 * Prefers the promised date over the expected one - promised is what the vendor
 * committed to, expected is what we assumed.
 */
export function buildIncomingMap(lines: PurchaseLine[]): Map<string, ItemIncoming> {
  const byItem = new Map<string, ItemIncoming>();

  for (const line of lines) {
    if (!line.itemNo || line.outstandingQuantity <= 0) continue;
    const current = byItem.get(line.itemNo) ?? { outstanding: 0, nextReceipt: null, lines: 0 };

    current.outstanding += line.outstandingQuantity;
    current.lines += 1;

    const date = line.promisedReceiptDate ?? line.expectedReceiptDate;
    if (date && (!current.nextReceipt || date < current.nextReceipt)) {
      current.nextReceipt = date;
    }

    byItem.set(line.itemNo, current);
  }

  return byItem;
}

// --- can this order run? ----------------------------------------------------

export type Shortage = {
  itemNo: string;
  description: string;
  needed: number;
  available: number;
  short: number;
  /** When the gap is expected to be filled, if anything is on order. */
  nextReceipt: string | null;
};

/**
 * Component lines an order has not got enough stock for.
 *
 * `remainingQuantity` is what is still to consume, so a partly consumed line
 * only counts for the rest. An item with no stock row at all is treated as zero
 * available rather than skipped - absence of a row is absence of stock.
 */
/**
 * A BC component row, narrowed to what a client component can use.
 *
 * Every page that hands components to the browser goes through here. Spreading
 * the row instead is how 213 KB of unread fields ended up serialised into the
 * HTML of three pages - and a spread will not warn you, because excess property
 * checks do not apply to it.
 */
export function toComponentLine(
  component: ProdOrderComponent,
  /**
   * Item No. to description, for the 8% of lines BC left blank.
   *
   * Required rather than optional on purpose: a page that forgot to pass it
   * would show a column of empty descriptions and look like it was working.
   */
  descriptions: ReadonlyMap<string, string>,
): ComponentLine {
  return {
    prodOrderNo: component.prodOrderNo,
    prodOrderLineNo: component.prodOrderLineNo,
    lineNo: component.lineNo,
    status: component.status,
    itemNo: component.itemNo,
    // The line's own copy first - it is what BC printed on the works order -
    // and the item card only where that copy is blank.
    description: component.description || descriptions.get(component.itemNo) || "",
    unitOfMeasureCode: component.unitOfMeasureCode,
    remainingQuantity: component.remainingQuantity,
    expectedQuantity: component.expectedQuantity,
    locationCode: component.locationCode,
    dueDate: component.dueDate,
    qtyPicked: component.qtyPicked,
    completelyPicked: component.completelyPicked,
  };
}

/** The same, plus the work centre and the stock join the tables show. */
export function toBoardComponent(
  component: ProdOrderComponent,
  workCenter: string,
  stock: Map<string, ItemStock>,
  incoming: Map<string, ItemIncoming>,
  descriptions: ReadonlyMap<string, string>,
): BoardComponent {
  const held = stock.get(component.itemNo);
  const coming = incoming.get(component.itemNo);
  return {
    ...toComponentLine(component, descriptions),
    workCenter,
    available: held?.available ?? 0,
    earliestExpiry: held?.earliestExpiry ?? null,
    nextReceipt: coming?.nextReceipt ?? null,
  };
}

export function shortagesFor(
  components: ComponentLine[],
  stock: Map<string, ItemStock>,
  incoming: Map<string, ItemIncoming>,
): Shortage[] {
  const shortages: Shortage[] = [];

  for (const component of components) {
    const needed = component.remainingQuantity;
    if (needed <= 0) continue;

    const available = stock.get(component.itemNo)?.available ?? 0;
    if (available >= needed) continue;

    shortages.push({
      itemNo: component.itemNo,
      description: component.description,
      needed,
      available,
      short: needed - available,
      nextReceipt: incoming.get(component.itemNo)?.nextReceipt ?? null,
    });
  }

  return shortages.sort((a, b) => b.short - a.short);
}

// --- who it is for ----------------------------------------------------------

export function buildSalesOrderMap(orders: SalesOrder[]): Map<string, SalesOrder> {
  const byNo = new Map<string, SalesOrder>();
  for (const order of orders) {
    if (order.no) byNo.set(order.no, order);
  }
  return byNo;
}

export function buildSalesLinesMap(lines: SalesLine[]): Map<string, SalesLine[]> {
  const byOrder = new Map<string, SalesLine[]>();
  for (const line of lines) {
    if (!line.documentNo) continue;
    if (!byOrder.has(line.documentNo)) byOrder.set(line.documentNo, []);
    byOrder.get(line.documentNo)!.push(line);
  }
  return byOrder;
}

// --- can it be picked? ------------------------------------------------------

/**
 * The four states the Picking Control Board sorts orders into, and the reason
 * this join exists at all. A count of short lines is a number; this is a
 * decision — it says what to do with the order this morning.
 */
export type PickState =
  | "can-pick" // every component line has the stock to cover it
  | "some-missing" // some lines covered, some not
  | "none-available" // nothing on any line can be picked
  | "nothing-to-pick"; // no manually flushed lines with anything left

export const PICK_STATES: { key: PickState; label: string; tone: "good" | "warn" | "crit" | null }[] = [
  { key: "can-pick", label: "Can pick complete", tone: "good" },
  { key: "some-missing", label: "Some components missing", tone: "warn" },
  { key: "none-available", label: "No components available", tone: "crit" },
  { key: "nothing-to-pick", label: "Nothing to pick", tone: null },
];

export function pickStateLabel(state: PickState): string {
  return PICK_STATES.find((s) => s.key === state)?.label ?? state;
}

/**
 * Classify one order from its component lines.
 *
 * Only lines with something left to consume count. An order whose lines are all
 * fully consumed is "nothing to pick" rather than "can pick": there is no work,
 * and calling it ready would put it in front of someone for no reason.
 */
export function pickStateFor(
  components: ComponentLine[],
  stock: Map<string, ItemStock>,
): PickState {
  const outstanding = components.filter((c) => c.remainingQuantity > 0);
  if (outstanding.length === 0) return "nothing-to-pick";

  let covered = 0;
  for (const component of outstanding) {
    const available = stock.get(component.itemNo)?.available ?? 0;
    if (available >= component.remainingQuantity) covered += 1;
  }

  if (covered === outstanding.length) return "can-pick";
  // Nothing at all coverable is worth separating from "some missing" - it means
  // the order cannot start, not that it will stall partway.
  if (covered === 0) return "none-available";
  return "some-missing";
}

/** Every order's pick state, keyed by production order number. */
export function buildPickStateMap(
  componentsByOrder: Map<string, ComponentLine[]> | Record<string, ComponentLine[]>,
  stock: Map<string, ItemStock>,
): Map<string, PickState> {
  const entries =
    componentsByOrder instanceof Map
      ? [...componentsByOrder.entries()]
      : Object.entries(componentsByOrder);

  const states = new Map<string, PickState>();
  for (const [orderNo, components] of entries) {
    states.set(orderNo, pickStateFor(components, stock));
  }
  return states;
}

/** How many orders sit in each state, in the order the board displays them. */
export function countPickStates(states: Map<string, PickState>): Record<PickState, number> {
  const counts: Record<PickState, number> = {
    "can-pick": 0,
    "some-missing": 0,
    "none-available": 0,
    "nothing-to-pick": 0,
  };
  for (const state of states.values()) counts[state] += 1;
  return counts;
}
