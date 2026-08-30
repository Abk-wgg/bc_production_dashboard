// Covers the pure modules - the ones that decide what the board actually says.
// No BC access, so these run anywhere, including before the Entra app
// registration exists.
//
//   npm test
//
// Node runs TypeScript directly by stripping the types, so there is no build
// step and no test-runner dependency.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkCenterMap,
  categorise,
  centersOf,
  hasVisibleCenter,
  withWorkCenters,
  UNASSIGNED,
} from "../src/lib/work-center.ts";
import {
  groupByDay,
  initialDayIndex,
  toWorkCenterColumns,
  workCentersIn,
  NO_DATE,
} from "../src/lib/schedule.ts";
import {
  isOutstanding,
  isBehindPlan,
  isLateToStart,
  isStartingSoon,
  daysBehindPlan,
  summarise,
} from "../src/lib/board.ts";
import {
  buildFloorMap,
  countFloorStates,
  floorStatusOf,
  isOnTheLine,
} from "../src/lib/floor.ts";
import { toStatus, statusName, RELEASED, FINISHED } from "../src/lib/status.ts";
import {
  formatDate,
  formatLineNo,
  formatWeekRange,
  compactQuantity,
  exportFileName,
} from "../src/lib/format.ts";
import { safeCallbackUrl } from "../src/lib/safe-redirect.ts";
import { groupByOrder, isShort, shortfallOf } from "../src/lib/component-groups.ts";
import { pageWindow, GAP } from "../src/lib/paging.ts";
import { DATE_PRESETS, parseDateFilter } from "../src/lib/date-filter.ts";
import {
  mondayOf,
  sundayOf,
  weekNumber,
  weekLabel,
  isPastWeek,
  initialWeekIndex,
  daysOf,
  weeksMatching,
  weekSpan,
} from "../src/lib/weeks.ts";
import { groupByVendorWeek, toVendorLines, vendorsIn, weeksIn } from "../src/lib/vendor-weeks.ts";
import { groupLinesByItem } from "../src/lib/item-groups.ts";
import {
  isBoardLocation,
  isBoardStatus,
  isManuallyFlushed,
  toFlushingMethod,
  BOARD_STATUS,
  MANUAL,
} from "../src/lib/scope.ts";
import {
  buildProgressMap,
  buildStockMap,
  buildIncomingMap,
  completionOf,
  shortagesFor,
  pickStateFor,
  countPickStates,
  buildPickStateMap,
  toComponentLine,
} from "../src/lib/chain.ts";
import type {
  ProductionOrder,
  ProdOrderRoutingLine,
  OutputEvent,
  StockLot,
  PurchaseLine,
  ProdOrderComponent,
} from "../src/lib/types.ts";

function order(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    no: "OLCRELPROD100",
    status: RELEASED,
    description: "OLC NERD 10ML VMT 20MG",
    itemNo: "ELN-OLC-S10-VMT-20M",
    routingNo: "R100",
    quantity: 1000,
    finishedQuantity: 0,
    dueDate: "2026-09-10",
    startingDate: "2026-09-08",
    endingDate: "2026-09-09",
    finishedDate: null,
    locationCode: "PRODUCTION",
    assignedUserId: "",
    brand: "FEAST TREATS",
    salesOrderNo: "OLCSO-77",
    scheduled: true,
    completelyPicked: false,
    flavour: "",
    strength: "",
    cartoned: "",
    ...overrides,
  };
}

function line(overrides: Partial<ProdOrderRoutingLine> = {}): ProdOrderRoutingLine {
  return {
    prodOrderNo: "OLCRELPROD100",
    status: RELEASED,
    routingNo: "R100",
    operationNo: "10",
    nextOperationNo: "",
    type: "Work Center",
    no: "PROD1",
    workCenterNo: "PROD1",
    workCenterGroupCode: "",
    description: "Mixing",
    setupTime: 0,
    runTime: 0,
    expectedCapacityNeed: 0,
    routingStatus: "",
    startingDate: null,
    endingDate: null,
    locationCode: "PRODUCTION",
    scheduled: true,
    earliestStartDate: null,
    emad: null,
    notFullyPromised: false,
    ...overrides,
  };
}

test("work centre comes from routing lines, with PRINTING excluded", () => {
  const map = buildWorkCenterMap([
    line({ no: "PRINTING", workCenterNo: "PRINTING", operationNo: "10" }),
    line({ no: "PROD2", workCenterNo: "PROD2", operationNo: "20" }),
  ]);
  assert.equal(map.get("OLCRELPROD100"), "PROD2");
});

test("an order on two centres lists both, sorted and de-duplicated", () => {
  const map = buildWorkCenterMap([
    line({ no: "TRADE1", operationNo: "10", workCenterNo: "TRADE1" }),
    line({ no: "PROD1", operationNo: "20" }),
    line({ no: "PROD1", operationNo: "30" }),
  ]);
  assert.equal(map.get("OLCRELPROD100"), "PROD1, TRADE1");
});

test("an order whose only operation is PRINTING has no work centre", () => {
  const map = buildWorkCenterMap([line({ no: "PRINTING", workCenterNo: "PRINTING" })]);
  assert.equal(map.get("OLCRELPROD100"), undefined);
  assert.equal(withWorkCenters([order()], [line({ no: "PRINTING", workCenterNo: "PRINTING" })])[0].workCenter, "");
});

test("machine centre inside the PRINTING work centre is excluded too", () => {
  // `no` is the machine centre; `workCenterNo` is the work centre it sits in.
  const map = buildWorkCenterMap([line({ no: "PRESS-3", workCenterNo: "PRINTING" })]);
  assert.equal(map.get("OLCRELPROD100"), undefined);
});

test("every centre is ours unless it is on the trade list, which is empty", () => {
  assert.equal(categorise("PROD1"), "production");
  assert.equal(categorise("prod-line-2"), "production");
  // Would have been trade under the old startsWith("PROD") rule.
  assert.equal(categorise("ANYTHING-ELSE"), "production");
  assert.equal(categorise(""), "unassigned");
});

test("days sort ascending with unscheduled orders last", () => {
  const days = groupByDay(
    withWorkCenters(
      [order({ no: "A" }), order({ no: "B" }), order({ no: "C" })],
      [
        line({ prodOrderNo: "B", startingDate: "2026-09-11" }),
        line({ prodOrderNo: "A", startingDate: "2026-09-10" }),
        // C has no routing line, so nothing schedules it.
      ],
    ),
  );
  assert.deepEqual(
    days.map((d) => d.key),
    ["2026-09-10", "2026-09-11", NO_DATE],
  );
});

test("the schedule day is the routing start date, not the due date", () => {
  // The distinction the whole page turns on: this order is owed in October but
  // runs in September, and it belongs on the September day.
  const [row] = withWorkCenters(
    [order({ no: "A", dueDate: "2026-10-30" })],
    [line({ prodOrderNo: "A", startingDate: "2026-09-14" })],
  );
  assert.equal(row.scheduledStart, "2026-09-14");
  assert.equal(groupByDay([row])[0].key, "2026-09-14");
});

test("an order takes the earliest start across its operations", () => {
  const [row] = withWorkCenters(
    [order({ no: "A" })],
    [
      line({ prodOrderNo: "A", no: "PROD2", operationNo: "20", startingDate: "2026-09-16" }),
      line({ prodOrderNo: "A", no: "PROD1", operationNo: "10", startingDate: "2026-09-14" }),
    ],
  );
  assert.equal(row.scheduledStart, "2026-09-14");
});

test("the routing comes from the line, not the header that reads ERROR_ROUTE", () => {
  // The header carries a Routing No. too, and it reads ERROR_ROUTE on 669 of
  // 982 released orders where the lines for those same orders read it on 26.
  const [row] = withWorkCenters(
    [order({ no: "A", routingNo: "ERROR_ROUTE" })],
    [line({ prodOrderNo: "A", routingNo: "10ML-UNCARTONED" })],
  );
  assert.equal(row.routingNo, "10ML-UNCARTONED");
});

test("an order with no routing line keeps its header routing rather than blanking", () => {
  const [row] = withWorkCenters([order({ no: "A", routingNo: "ERROR_ROUTE" })], []);
  assert.equal(row.routingNo, "ERROR_ROUTE");
});

test("PRINTING is excluded from the work centre but not from the routing", () => {
  // The two questions differ: printing distorts "where does this run", but an
  // order whose only line is a printing one is still on that line's routing.
  const [row] = withWorkCenters(
    [order({ no: "A", routingNo: "" })],
    [line({ prodOrderNo: "A", no: "PRINTING", workCenterNo: "PRINTING", routingNo: "10ML-PROD-CARTON" })],
  );
  assert.equal(row.workCenter, "");
  assert.equal(row.routingNo, "10ML-PROD-CARTON");
});

test("PRINTING does not schedule an order any more than it locates it", () => {
  const [row] = withWorkCenters(
    [order({ no: "A" })],
    [line({ prodOrderNo: "A", no: "PRINTING", workCenterNo: "PRINTING", startingDate: "2026-09-14" })],
  );
  assert.equal(row.workCenter, "");
  assert.equal(row.scheduledStart, null);
});

test("columns order production first, then unassigned", () => {
  // The trade tier is currently unreachable: TRADE_CENTERS is empty because
  // every centre on this board is ours. CATEGORY_ORDER still supports it.
  const orders = withWorkCenters(
    [order({ no: "A" }), order({ no: "B" })],
    // B has no routing line at all, so it lands in the unassigned column.
    [line({ prodOrderNo: "A", no: "PROD1" })],
  );
  const columns = toWorkCenterColumns(orders);
  assert.deepEqual(
    columns.map((c) => c.category),
    ["production", "unassigned"],
  );
});

test("an order spanning two centres appears in both columns", () => {
  const orders = withWorkCenters(
    [order({ no: "A" })],
    [line({ prodOrderNo: "A", no: "PROD1" }), line({ prodOrderNo: "A", no: "TRADE1", workCenterNo: "TRADE1" })],
  );
  const columns = toWorkCenterColumns(orders);
  assert.deepEqual(columns.map((c) => c.workCenter), ["PROD1", "TRADE1"]);
  assert.equal(columns[0].orders[0].no, "A");
  assert.equal(columns[1].orders[0].no, "A");
});

test("hiding a work centre drops its column", () => {
  const orders = withWorkCenters(
    [order({ no: "A" }), order({ no: "B" })],
    [line({ prodOrderNo: "A", no: "PROD-1" }), line({ prodOrderNo: "B", no: "UNPLANNED" })],
  );
  assert.deepEqual(
    toWorkCenterColumns(orders, new Set(["UNPLANNED"])).map((c) => c.workCenter),
    ["PROD-1"],
  );
  assert.deepEqual(toWorkCenterColumns(orders, new Set(["PROD-1", "UNPLANNED"])), []);
});

test("an order spanning two centres survives one of them being hidden", () => {
  // It genuinely needs both, so hiding OUTSIDE-LINE must not take it out of the
  // PROD-1 column as well - that would understate the centre still selected.
  const orders = withWorkCenters(
    [order({ no: "A" })],
    [line({ prodOrderNo: "A", no: "PROD-1" }), line({ prodOrderNo: "A", no: "OUTSIDE-LINE" })],
  );
  assert.equal(hasVisibleCenter(orders[0].workCenter, new Set(["OUTSIDE-LINE"])), true);
  const columns = toWorkCenterColumns(orders, new Set(["OUTSIDE-LINE"]));
  assert.deepEqual(columns.map((c) => c.workCenter), ["PROD-1"]);
  assert.equal(columns[0].orders[0].no, "A");
});

test("hiding every centre an order sits on removes it", () => {
  const orders = withWorkCenters([order({ no: "A" })], [line({ prodOrderNo: "A", no: "PROD-1" })]);
  assert.equal(hasVisibleCenter(orders[0].workCenter, new Set(["PROD-1"])), false);
});

test("an order with no routing line is its own selectable centre", () => {
  assert.deepEqual(centersOf(""), [UNASSIGNED]);
  assert.equal(hasVisibleCenter("", new Set([UNASSIGNED])), false);
  assert.equal(hasVisibleCenter("", new Set()), true);
});

test("the centre list matches the column order, unassigned last", () => {
  const orders = withWorkCenters(
    [order({ no: "A" }), order({ no: "B" }), order({ no: "C" })],
    [line({ prodOrderNo: "A", no: "PROD-2" }), line({ prodOrderNo: "B", no: "PROD-1" })],
  );
  // C has no routing line, so it contributes the unassigned bucket.
  assert.deepEqual(workCentersIn(orders), ["PROD-1", "PROD-2", UNASSIGNED]);
});

test("outstanding is driven by status, never by finishedQuantity", () => {
  // The whole point: a finished order with finishedQuantity 0 is still finished.
  assert.equal(isOutstanding(order({ status: FINISHED, finishedQuantity: 0 })), false);
  assert.equal(isOutstanding(order({ status: RELEASED, finishedQuantity: 0 })), true);
});

test("behind plan reads the planned end date, never the due date", () => {
  const asOf = "2026-09-10";
  // The due date is a day later than the planned end on nearly every order in
  // this tenant, so judging on it would call a late order on time for a day.
  assert.equal(isBehindPlan(order({ endingDate: "2026-09-09", dueDate: "2026-09-30" }), asOf), true);
  assert.equal(isBehindPlan(order({ endingDate: "2026-09-10" }), asOf), false);
  assert.equal(isBehindPlan(order({ endingDate: null, dueDate: "2026-01-01" }), asOf), false);
  assert.equal(
    isBehindPlan(order({ endingDate: "2026-09-09", status: FINISHED }), asOf),
    false,
  );
});

test("late to start reads the planned start", () => {
  const asOf = "2026-09-10";
  assert.equal(isLateToStart(order({ startingDate: "2026-09-09" }), asOf), true);
  assert.equal(isLateToStart(order({ startingDate: "2026-09-10" }), asOf), false);
  assert.equal(isLateToStart(order({ startingDate: null }), asOf), false);
});

test("starting soon spans today to seven days out inclusive", () => {
  const asOf = "2026-09-10";
  assert.equal(isStartingSoon(order({ startingDate: "2026-09-10" }), asOf), true);
  assert.equal(isStartingSoon(order({ startingDate: "2026-09-17" }), asOf), true);
  assert.equal(isStartingSoon(order({ startingDate: "2026-09-18" }), asOf), false);
  // Yesterday is late, not soon - it belongs in the other count.
  assert.equal(isStartingSoon(order({ startingDate: "2026-09-09" }), asOf), false);
});

test("days behind plan never goes negative", () => {
  assert.equal(daysBehindPlan(order({ endingDate: "2026-09-07" }), "2026-09-10"), 3);
  assert.equal(daysBehindPlan(order({ endingDate: "2026-09-20" }), "2026-09-10"), 0);
  assert.equal(daysBehindPlan(order({ endingDate: null }), "2026-09-10"), 0);
});

test("summary counts outstanding work, not every row", () => {
  const summary = summarise(
    [
      order({ no: "A", startingDate: "2026-09-06", endingDate: "2026-09-09", quantity: 100 }),
      order({ no: "B", status: FINISHED, quantity: 999 }),
      order({
        no: "C",
        startingDate: "2026-09-12",
        endingDate: "2026-09-13",
        quantity: 50,
        scheduled: false,
      }),
    ],
    "2026-09-10",
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.outstanding, 2);
  assert.equal(summary.behindPlan, 1);
  assert.equal(summary.startingSoon, 1);
  assert.equal(summary.unscheduled, 1);
  assert.equal(summary.unplanned, 0);
  assert.equal(summary.outstandingUnits, 150);
});

test("status accepts the option index or its caption", () => {
  assert.equal(toStatus(3), RELEASED);
  assert.equal(toStatus("Released"), RELEASED);
  assert.equal(toStatus("finished"), FINISHED);
  assert.equal(statusName(RELEASED), "Released");
  // Unknown values default to Released so live orders are never hidden.
  assert.equal(toStatus("Something else"), RELEASED);
  assert.equal(toStatus(""), RELEASED);
});

test("dates format without shifting across timezones", () => {
  assert.equal(formatDate("2026-06-24"), "24 Jun 2026");
  assert.equal(formatDate(null), "");
});

test("BC line numbers display as human line numbers", () => {
  assert.equal(formatLineNo(10000), "1");
  assert.equal(formatLineNo(30000), "3");
  assert.equal(formatLineNo(0), "");
});

test("sign-in only ever returns to a path on this site", () => {
  assert.equal(safeCallbackUrl("/schedule"), "/schedule");
  assert.equal(safeCallbackUrl("/components?order=OLCRELPROD100"), "/components?order=OLCRELPROD100");
  assert.equal(safeCallbackUrl(undefined), "/");
  assert.equal(safeCallbackUrl(""), "/");
  // Absolute and protocol-relative URLs are the phishing shapes.
  assert.equal(safeCallbackUrl("https://evil.example.com"), "/");
  assert.equal(safeCallbackUrl("//evil.example.com"), "/");
  // String.raw so the backslash is unmistakably a backslash - written as a
  // plain literal, "\e" is not a valid escape and collapses to "e", which
  // makes the test silently assert something else.
  assert.equal(safeCallbackUrl(String.raw`/\evil.example.com`), "/");
});

test("the board is only the PRODUCTION location", () => {
  assert.equal(isBoardLocation("PRODUCTION"), true);
  assert.equal(isBoardLocation("production"), true);
  assert.equal(isBoardLocation(" PRODUCTION "), true);
  // TRADE is the one that has to be excluded - it outnumbers production
  // roughly fifteen to one, so letting it through swamps the board.
  assert.equal(isBoardLocation("TRADE"), false);
  assert.equal(isBoardLocation(""), false);
});

test("the board is only Released orders", () => {
  assert.equal(BOARD_STATUS, RELEASED);
  assert.equal(isBoardStatus(RELEASED), true);
  // Not yet real work.
  assert.equal(isBoardStatus(0), false);
  assert.equal(isBoardStatus(1), false);
  assert.equal(isBoardStatus(2), false);
  // Over. Finished orders are history, not a board.
  assert.equal(isBoardStatus(FINISHED), false);
});

test("flushing method accepts the option index or its caption", () => {
  assert.equal(toFlushingMethod(0), MANUAL);
  assert.equal(toFlushingMethod("0"), MANUAL);
  assert.equal(toFlushingMethod("Manual"), MANUAL);
  assert.equal(toFlushingMethod(2), 2);
  assert.equal(toFlushingMethod("Backward"), 2);
  assert.equal(toFlushingMethod("Pick + Forward"), 3);
  // Unreadable values are treated as Manual: dropping a component line because
  // we could not parse its flushing method would hide real work.
  assert.equal(toFlushingMethod("something new"), MANUAL);
  assert.equal(toFlushingMethod(undefined), MANUAL);
});

test("only manually flushed components are shown", () => {
  assert.equal(isManuallyFlushed(MANUAL), true);
  // Forward and backward flushed lines are consumed by BC on their own, so
  // nobody works from them.
  assert.equal(isManuallyFlushed(1), false);
  assert.equal(isManuallyFlushed(2), false);
  assert.equal(isManuallyFlushed(3), false);
});


// --- the chain --------------------------------------------------------------

function event(overrides: Partial<OutputEvent> = {}): OutputEvent {
  return {
    entryNo: 1,
    prodOrderNo: "A",
    sourceNo: "ITEM-1",
    buttonEvent: "Complete",
    eventType: "Output",
    at: "2026-08-03T06:06:14Z",
    lineLeader: "",
    qtyOutput: 0,
    qtyScrapped: 0,
    booked: true,
    lotNo: "",
    ...overrides,
  };
}

function lot(overrides: Partial<StockLot> = {}): StockLot {
  return {
    itemNo: "ITEM-1",
    variantCode: "",
    lotNo: "L1",
    description: "",
    itemCategoryCode: "",
    locationCode: "PRODUCTION",
    binCode: "",
    quantity: 100,
    availableQuantity: 100,
    unitOfMeasureCode: "KG",
    available: true,
    expiryDate: null,
    productionDate: null,
    lotStatus: "RELEASED",
    ...overrides,
  };
}

function poLine(overrides: Partial<PurchaseLine> = {}): PurchaseLine {
  return {
    documentNo: "PO-1",
    lineNo: 10000,
    vendorNo: "V1",
    itemNo: "ITEM-1",
    description: "",
    locationCode: "PRODUCTION",
    quantity: 100,
    outstandingQuantity: 100,
    quantityReceived: 0,
    expectedReceiptDate: "2026-09-20",
    promisedReceiptDate: null,
    orderDate: null,
    unitOfMeasureCode: "KG",
    completelyReceived: false,
    ...overrides,
  };
}

function component(overrides: Partial<ProdOrderComponent> = {}): ProdOrderComponent {
  return {
    prodOrderNo: "A",
    prodOrderLineNo: 10000,
    lineNo: 10000,
    status: RELEASED,
    itemNo: "ITEM-1",
    description: "Bottle",
    unitOfMeasureCode: "EA",
    quantityPer: 1,
    quantity: 100,
    remainingQuantity: 100,
    expectedQuantity: 100,
    locationCode: "PRODUCTION",
    binCode: "",
    variantCode: "",
    dueDate: null,
    flushingMethod: MANUAL,
    qtyPicked: 0,
    completelyPicked: false,
    emad: null,
    ...overrides,
  };
}

test("output is summed net of reversals, never absolute", () => {
  // A correction posts a matching negative row. Taking absolutes here would
  // report 1806 made when the true figure is nil.
  const progress = buildProgressMap([
    event({ qtyOutput: 903 }),
    event({ qtyOutput: -903 }),
  ]);
  assert.equal(progress.get("A")?.made, 0);
});

test("scrap comes from Scrap events only, not Consumption rows", () => {
  const progress = buildProgressMap([
    event({ eventType: "Output", qtyOutput: 1000 }),
    event({ eventType: "Scrap", qtyScrapped: 12 }),
    // Consumption rows carry a scrap quantity too - counting it would double up.
    event({ eventType: "Consumption", qtyScrapped: 5 }),
  ]);
  assert.equal(progress.get("A")?.made, 1000);
  assert.equal(progress.get("A")?.scrapped, 12);
});

test("Start and Pause presses book no quantity", () => {
  const progress = buildProgressMap([
    event({ buttonEvent: "Start", eventType: "" }),
    event({ buttonEvent: "Pause", eventType: "" }),
  ]);
  assert.equal(progress.get("A"), undefined);
});

test("progress is capped at 100% for display but overproduction is kept", () => {
  assert.equal(completionOf(50, 100), 0.5);
  assert.equal(completionOf(150, 100), 1);
  assert.equal(completionOf(10, 0), 0);
});

test("stock sums lots and keeps the earliest expiry", () => {
  const stock = buildStockMap([
    lot({ lotNo: "L1", availableQuantity: 20, expiryDate: "2028-07-29" }),
    lot({ lotNo: "L2", availableQuantity: 5, expiryDate: "2028-07-07" }),
  ]);
  assert.equal(stock.get("ITEM-1")?.available, 25);
  assert.equal(stock.get("ITEM-1")?.lots, 2);
  assert.equal(stock.get("ITEM-1")?.earliestExpiry, "2028-07-07");
});

test("incoming supply prefers the promised date over the expected one", () => {
  const incoming = buildIncomingMap([
    poLine({ expectedReceiptDate: "2026-09-20", promisedReceiptDate: "2026-09-25" }),
  ]);
  // Promised is what the vendor committed to; expected is what we assumed.
  assert.equal(incoming.get("ITEM-1")?.nextReceipt, "2026-09-25");
});

test("a fully received line is not incoming", () => {
  const incoming = buildIncomingMap([poLine({ outstandingQuantity: 0 })]);
  assert.equal(incoming.get("ITEM-1"), undefined);
});

test("a shortage is remaining demand the free stock cannot cover", () => {
  const stock = buildStockMap([lot({ availableQuantity: 30 })]);
  const incoming = buildIncomingMap([poLine({ promisedReceiptDate: "2026-09-25" })]);
  const [short] = shortagesFor([component({ remainingQuantity: 100 })], stock, incoming);
  assert.equal(short.short, 70);
  assert.equal(short.nextReceipt, "2026-09-25");
});

test("an item with no stock row at all is short, not skipped", () => {
  // Absence of a stock row is absence of stock - treating it as unknown would
  // quietly drop the very lines most worth seeing.
  const [short] = shortagesFor([component({ itemNo: "NOT-STOCKED" })], new Map(), new Map());
  assert.equal(short.itemNo, "NOT-STOCKED");
  assert.equal(short.available, 0);
  assert.equal(short.short, 100);
});

test("a line with nothing left to consume cannot be short", () => {
  assert.deepEqual(shortagesFor([component({ remainingQuantity: 0 })], new Map(), new Map()), []);
});


test("an order whose every line is covered can be picked complete", () => {
  const stock = buildStockMap([lot({ availableQuantity: 200 })]);
  assert.equal(pickStateFor([component({ remainingQuantity: 100 })], stock), "can-pick");
});

test("partly covered is 'some missing', not 'none available'", () => {
  const stock = buildStockMap([lot({ itemNo: "A", availableQuantity: 200 })]);
  const state = pickStateFor(
    [
      component({ itemNo: "A", remainingQuantity: 100 }),
      component({ itemNo: "B", remainingQuantity: 100 }),
    ],
    stock,
  );
  assert.equal(state, "some-missing");
});

test("nothing coverable is its own state - the order cannot start at all", () => {
  const state = pickStateFor([component({ remainingQuantity: 100 })], new Map());
  assert.equal(state, "none-available");
});

test("an order with nothing left to consume is 'nothing to pick', not 'can pick'", () => {
  // Calling a finished-picking order ready would put it in front of someone
  // for no reason.
  const stock = buildStockMap([lot({ availableQuantity: 999 })]);
  assert.equal(pickStateFor([component({ remainingQuantity: 0 })], stock), "nothing-to-pick");
  assert.equal(pickStateFor([], stock), "nothing-to-pick");
});

test("exact cover counts as covered, not short", () => {
  const stock = buildStockMap([lot({ availableQuantity: 100 })]);
  assert.equal(pickStateFor([component({ remainingQuantity: 100 })], stock), "can-pick");
});

test("pick states are counted across every order", () => {
  const stock = buildStockMap([lot({ itemNo: "A", availableQuantity: 500 })]);
  const states = buildPickStateMap(
    {
      ok: [component({ itemNo: "A", remainingQuantity: 100 })],
      bad: [component({ itemNo: "Z", remainingQuantity: 100 })],
      done: [component({ remainingQuantity: 0 })],
    },
    stock,
  );
  const counts = countPickStates(states);
  assert.equal(counts["can-pick"], 1);
  assert.equal(counts["none-available"], 1);
  assert.equal(counts["nothing-to-pick"], 1);
  assert.equal(counts["some-missing"], 0);
});


// --- floor status -----------------------------------------------------------

test("a button press maps to what the line is doing", () => {
  assert.equal(floorStatusOf("Start"), "running");
  assert.equal(floorStatusOf("Restart"), "running");
  // Complete is its own state. Usually it is the end of production and the
  // batch is waiting on QA; on a large order the floor completes and QA-books
  // several times over. Either way nothing is being made, which is what
  // Running is for. Whether the ORDER is done is BC's Finished status, a
  // different question this file does not answer.
  assert.equal(floorStatusOf("Complete"), "complete");
  assert.equal(floorStatusOf("Pause"), "paused");
  assert.equal(floorStatusOf("QA Book"), "qa-booked");
  // Something happened, so it cannot be "not started".
  assert.equal(floorStatusOf("Some New Button"), "running");
});

test("floor status is the last press, not the first", () => {
  const floor = buildFloorMap([
    event({ prodOrderNo: "A", entryNo: 1, buttonEvent: "Start", at: "2026-08-28T06:00:00Z" }),
    event({
      prodOrderNo: "A",
      entryNo: 2,
      buttonEvent: "Pause",
      at: "2026-08-28T09:30:00Z",
      lineLeader: "Esther Cheng",
    }),
  ]);

  assert.equal(floor.get("A")?.status, "paused");
  assert.equal(floor.get("A")?.operator, "Esther Cheng");
  assert.equal(floor.get("A")?.at, "2026-08-28T09:30:00Z");
});

test("presses sharing a timestamp are ordered by entry number", () => {
  // These land milliseconds apart and BC can return them either way round. A
  // Complete and the QA Book after it say opposite things about the line, so
  // the tie-break is what stops the column flickering between the two.
  const floor = buildFloorMap([
    event({ prodOrderNo: "A", entryNo: 9, buttonEvent: "QA Book", at: "2026-08-28T11:47:27Z" }),
    event({ prodOrderNo: "A", entryNo: 8, buttonEvent: "Complete", at: "2026-08-28T11:47:27Z" }),
  ]);

  assert.equal(floor.get("A")?.status, "qa-booked");
});

test("an order with no events is not on the line", () => {
  const floor = buildFloorMap([event({ prodOrderNo: "A" })]);
  assert.equal(floor.has("B"), false);
  assert.equal(isOnTheLine("not-started"), false);
  assert.equal(isOnTheLine("qa-booked"), true);
  // Complete counts as touched: it was picked, started and made. Only an
  // order nobody has pressed anything on is off the line.
  assert.equal(isOnTheLine("complete"), true);
});

test("a large order cycles through Complete and QA Book more than once", () => {
  // Output posts at the QA Book, not the Complete, and BC finishes the order
  // there once posted output passes 96% of the order quantity. So a Complete
  // is the end of a batch, not necessarily the end of the order - the same
  // order reads Complete, then QA booked, then Running again over its life.
  const madeABatch = buildFloorMap([
    event({ prodOrderNo: "A", entryNo: 1, buttonEvent: "Start", at: "2026-08-20T06:00:00Z" }),
    event({ prodOrderNo: "A", entryNo: 2, buttonEvent: "Complete", at: "2026-08-21T14:00:00Z" }),
  ]);
  assert.equal(madeABatch.get("A")?.status, "complete");

  const backOnTheLine = buildFloorMap([
    event({ prodOrderNo: "A", entryNo: 1, buttonEvent: "Start", at: "2026-08-20T06:00:00Z" }),
    event({ prodOrderNo: "A", entryNo: 2, buttonEvent: "Complete", at: "2026-08-21T14:00:00Z" }),
    event({ prodOrderNo: "A", entryNo: 3, buttonEvent: "QA Book", at: "2026-08-22T09:00:00Z" }),
    event({ prodOrderNo: "A", entryNo: 4, buttonEvent: "Restart", at: "2026-08-23T06:00:00Z" }),
  ]);
  assert.equal(backOnTheLine.get("A")?.status, "running");
});

test("floor counts are taken over the orders on the board", () => {
  const floor = buildFloorMap([
    event({ prodOrderNo: "A", buttonEvent: "Start" }),
    event({ prodOrderNo: "B", buttonEvent: "Pause" }),
    // Belongs to an order this board does not show - TRADE, say. It must not
    // reach the totals, or the tiles count work that is not on the screen.
    event({ prodOrderNo: "Z", buttonEvent: "Start" }),
  ]);

  const counts = countFloorStates(["A", "B", "C"], floor);
  assert.deepEqual(counts, { running: 1, complete: 0, paused: 1, "qa-booked": 0, "not-started": 1 });
});

// --- which day the board opens on -------------------------------------------

test("the board opens on today when today has work", () => {
  const days = [{ key: "2026-08-28" }, { key: "2026-08-30" }, { key: "2026-09-01" }];
  assert.equal(initialDayIndex(days, "2026-08-30"), 1);
});

test("with nothing today it opens on the next day that has work", () => {
  const days = [{ key: "2026-08-28" }, { key: "2026-09-01" }];
  assert.equal(initialDayIndex(days, "2026-08-30"), 1);
});

test("the earliest day is not a landing place just because it is first", () => {
  // The real shape of this data: one stalled April order, then the actual work
  // five months later. Opening on index 0 is fifty clicks from today.
  const days = [{ key: "2026-04-02" }, { key: "2026-08-30" }, { key: "2026-09-01" }];
  assert.equal(initialDayIndex(days, "2026-08-30"), 1);
});

test("when every day is in the past it opens on the most recent, not the oldest", () => {
  const days = [{ key: "2026-04-02" }, { key: "2026-06-18" }];
  assert.equal(initialDayIndex(days, "2026-08-30"), 1);
});

test("unscheduled orders are never the landing day", () => {
  // NO_DATE sorts last and would compare greater than any ISO date as a string,
  // so it has to be skipped explicitly rather than by ordering alone.
  const days = [{ key: "2026-04-02" }, { key: NO_DATE }];
  assert.equal(initialDayIndex(days, "2026-08-30"), 0);
});

test("an empty board does not blow up", () => {
  assert.equal(initialDayIndex([], "2026-08-30"), 0);
});

// --- work centre classification ---------------------------------------------

test("UNPLANNED is our own production, not trade", () => {
  // It is work not yet assigned to a line, not work sent out.
  assert.equal(categorise("UNPLANNED"), "production");
  assert.equal(categorise("unplanned"), "production");
});

test("OUTSIDE-LINE is production too - nothing on this board is trade", () => {
  // The board is scoped to Location Code PRODUCTION, so scope.ts has already
  // removed the trade work upstream. All 982 orders are production.
  assert.equal(categorise("OUTSIDE-LINE"), "production");
});

test("every work centre in the real data is production", () => {
  // The ten centres actually present. Pinned so a change cannot quietly move a
  // quarter of the board into a filter nobody opens again.
  for (const wc of ["PROD-1", "PROD-2", "PROD-3", "PROD-4", "PROD-5", "PROD-6", "PROD-7", "PROD-SHORTFILL", "UNPLANNED", "OUTSIDE-LINE"])
    assert.equal(categorise(wc), "production", wc);
});

// --- component grouping ----------------------------------------------------

/** A component line with only the fields the grouping actually reads. */
function comp(over: Record<string, unknown> = {}) {
  return {
    prodOrderNo: "OLC1",
    prodOrderLineNo: 10000,
    lineNo: 10000,
    status: 3,
    itemNo: "RMC/1",
    description: "Thing",
    unitOfMeasureCode: "EACH",
    quantityPer: 1,
    quantity: 0,
    remainingQuantity: 100,
    expectedQuantity: 100,
    locationCode: "PRODUCTION",
    binCode: "",
    variantCode: "",
    dueDate: "2026-09-02",
    flushingMethod: 0,
    qtyPicked: 0,
    completelyPicked: false,
    emad: null,
    workCenter: "PROD-1",
    available: 500,
    earliestExpiry: null,
    onOrder: 0,
    nextReceipt: null,
    ...over,
  } as never;
}

test("component lines group into one row per order, in order-number order", () => {
  const groups = groupByOrder(
    [
      comp({ prodOrderNo: "OLC2" }),
      comp({ prodOrderNo: "OLC1", lineNo: 20000 }),
      comp({ prodOrderNo: "OLC1" }),
    ],
    true,
  );
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.prodOrderNo), ["OLC1", "OLC2"]);
  assert.equal(groups[0].lineCount, 2);
  assert.equal(groups[0].lines.length, 2);
});

test("quantities are summed and picking is counted across the lines", () => {
  const [group] = groupByOrder(
    [
      comp({ remainingQuantity: 100, qtyPicked: 40, completelyPicked: true }),
      comp({ lineNo: 20000, remainingQuantity: 250, qtyPicked: 10 }),
    ],
    true,
  );
  assert.equal(group.remaining, 350);
  assert.equal(group.picked, 50);
  assert.equal(group.pickedLines, 1);
  // One unpicked line is enough - an order is not ready until all of it is.
  assert.equal(group.fullyPicked, false);
});

test("an order is fully picked only when every line is", () => {
  const [group] = groupByOrder(
    [
      comp({ completelyPicked: true }),
      comp({ lineNo: 20000, completelyPicked: true }),
    ],
    true,
  );
  assert.equal(group.fullyPicked, true);
  assert.equal(group.pickedLines, 2);
});

test("shortages are only counted when the stock feed is complete", () => {
  const short = comp({ remainingQuantity: 100, available: 30, nextReceipt: "2026-09-10" });
  const known = groupByOrder([short], true)[0];
  assert.equal(known.shortLines, 1);
  assert.equal(known.shortBy, 70);
  assert.equal(known.nextReceipt, "2026-09-10");

  // A partial stock feed means an item with no row is unknown, not absent.
  const unknown = groupByOrder([short], false)[0];
  assert.equal(unknown.shortLines, 0);
  assert.equal(unknown.shortBy, 0);
  assert.equal(unknown.nextReceipt, null);
});

test("next delivery comes from short lines only", () => {
  const [group] = groupByOrder(
    [
      // Covered: its delivery is not news, so it must not set the date.
      comp({ remainingQuantity: 10, available: 900, nextReceipt: "2026-09-01" }),
      comp({ lineNo: 20000, remainingQuantity: 100, available: 0, nextReceipt: "2026-09-20" }),
    ],
    true,
  );
  assert.equal(group.nextReceipt, "2026-09-20");
});

test("needed date and expiry take the earliest across the lines", () => {
  const [group] = groupByOrder(
    [
      comp({ dueDate: "2026-09-08", earliestExpiry: "2027-01-01" }),
      comp({ lineNo: 20000, dueDate: "2026-09-02", earliestExpiry: null }),
      comp({ lineNo: 30000, dueDate: null, earliestExpiry: "2026-12-01" }),
    ],
    true,
  );
  assert.equal(group.neededDate, "2026-09-02");
  assert.equal(group.earliestExpiry, "2026-12-01");
});

test("a line is short only when something is left to consume", () => {
  assert.equal(isShort(comp({ remainingQuantity: 100, available: 30 })), true);
  assert.equal(shortfallOf(comp({ remainingQuantity: 100, available: 30 })), 70);
  // Nothing left to pick is not a shortage, however little stock there is.
  assert.equal(isShort(comp({ remainingQuantity: 0, available: 0 })), false);
  assert.equal(shortfallOf(comp({ remainingQuantity: 0, available: 0 })), 0);
});

// --- pager ------------------------------------------------------------------

test("a short list shows every page and no ellipsis", () => {
  assert.deepEqual(pageWindow(0, 1), [0]);
  assert.deepEqual(pageWindow(1, 3), [0, 1, 2]);
  assert.deepEqual(pageWindow(2, 5), [0, 1, 2, 3, 4]);
});

test("a long list keeps the first, the last and the neighbours", () => {
  assert.deepEqual(pageWindow(9, 20), [0, GAP, 8, 9, 10, GAP, 19]);
  assert.deepEqual(pageWindow(0, 20), [0, 1, GAP, 19]);
  assert.deepEqual(pageWindow(19, 20), [0, GAP, 18, 19]);
});

test("a gap of one page shows the page rather than an ellipsis", () => {
  // The ellipsis would take the same room as the number it hides.
  assert.deepEqual(pageWindow(0, 4), [0, 1, 2, 3]);
  assert.deepEqual(pageWindow(3, 5), [0, 1, 2, 3, 4]);
});

test("the window keeps a steady width through the middle", () => {
  // Otherwise the buttons shuffle sideways under the pointer between clicks.
  const widths = [5, 6, 7, 8, 9, 10].map((p) => pageWindow(p, 20).length);
  assert.deepEqual(widths, [7, 7, 7, 7, 7, 7]);
});

test("no pages means no buttons", () => {
  assert.deepEqual(pageWindow(0, 0), []);
});

// --- date filters -----------------------------------------------------------

// A Sunday, deliberately: the week runs Monday to Sunday, so the last day of
// the week is the fiddly one to get right.
const ASOF = "2026-08-30";

/** Does this expression match this date, read as of ASOF? */
function hits(expression: string, date: string): boolean {
  const match = parseDateFilter(expression, ASOF);
  assert.ok(match, `expected ${expression} to parse`);
  return match(date);
}

test("a date typed as ddmmyy is that date", () => {
  assert.equal(hits("300826", "2026-08-30"), true);
  assert.equal(hits("300826", "2026-08-29"), false);
  // Four-digit years and separators both work.
  assert.equal(hits("30082026", "2026-08-30"), true);
  assert.equal(hits("30/08/26", "2026-08-30"), true);
  assert.equal(hits("30-08-26", "2026-08-30"), true);
});

test("an impossible date does not parse", () => {
  // JS would roll 31 February into March on its own. Silently filtering on
  // the wrong date is worse than not filtering.
  assert.equal(parseDateFilter("310226", ASOF), null);
  assert.equal(parseDateFilter("321326", ASOF), null);
  // Half-typed, which is what an input holds most of the time.
  assert.equal(parseDateFilter("3008", ASOF), null);
  assert.equal(parseDateFilter("", ASOF), null);
  assert.equal(parseDateFilter("nonsense", ASOF), null);
});

test("c is current and l is last, over day, week, month and year", () => {
  assert.equal(hits("cd", "2026-08-30"), true);
  assert.equal(hits("cd", "2026-08-29"), false);
  assert.equal(hits("ld", "2026-08-29"), true);

  // ASOF is a Sunday, so the current week began on Monday the 24th.
  assert.equal(hits("cw", "2026-08-24"), true);
  assert.equal(hits("cw", "2026-08-30"), true);
  assert.equal(hits("cw", "2026-08-23"), false);
  assert.equal(hits("lw", "2026-08-17"), true);
  assert.equal(hits("lw", "2026-08-23"), true);
  assert.equal(hits("lw", "2026-08-24"), false);

  assert.equal(hits("cm", "2026-08-01"), true);
  assert.equal(hits("cm", "2026-08-31"), true);
  assert.equal(hits("cm", "2026-09-01"), false);
  assert.equal(hits("lm", "2026-07-31"), true);
  assert.equal(hits("lm", "2026-08-01"), false);

  assert.equal(hits("cy", "2026-01-01"), true);
  assert.equal(hits("cy", "2026-12-31"), true);
  assert.equal(hits("ly", "2025-12-31"), true);
});

test("the modifier and the unit work in either order, in any case", () => {
  assert.equal(hits("mc", "2026-08-15"), true);
  assert.equal(hits("CM", "2026-08-15"), true);
  assert.equal(hits(" c m ", "2026-08-15"), true);
  // A bare unit is the current one.
  assert.equal(hits("m", "2026-08-15"), true);
  assert.equal(hits("w", "2026-08-24"), true);
});

test("comparison operators read a period as a span, not a point", () => {
  assert.equal(hits(">300826", "2026-08-31"), true);
  assert.equal(hits(">300826", "2026-08-30"), false);
  assert.equal(hits(">=300826", "2026-08-30"), true);
  assert.equal(hits("<300826", "2026-08-29"), true);
  assert.equal(hits("<=300826", "2026-08-30"), true);

  // This is why a term is always a range: > a month means after it ends,
  // < a month means before it began.
  assert.equal(hits(">cm", "2026-09-01"), true);
  assert.equal(hits(">cm", "2026-08-31"), false);
  assert.equal(hits("<cm", "2026-07-31"), true);
  assert.equal(hits("<cm", "2026-08-01"), false);
  assert.equal(hits(">=cm", "2026-08-01"), true);
});

test("<> excludes the span", () => {
  assert.equal(hits("<>cm", "2026-07-31"), true);
  assert.equal(hits("<>cm", "2026-09-01"), true);
  assert.equal(hits("<>cm", "2026-08-15"), false);
});

test(".. is an inclusive range, either way round", () => {
  assert.equal(hits("200826..300826", "2026-08-20"), true);
  assert.equal(hits("200826..300826", "2026-08-30"), true);
  assert.equal(hits("200826..300826", "2026-08-19"), false);
  assert.equal(hits("200826..300826", "2026-08-31"), false);
  // Typed backwards, which people do.
  assert.equal(hits("300826..200826", "2026-08-25"), true);
  // Keywords work as endpoints too.
  assert.equal(hits("lm..cm", "2026-07-01"), true);
  assert.equal(hits("lm..cm", "2026-08-31"), true);
  assert.equal(hits("lm..cm", "2026-09-01"), false);
});

test("& is and, | is or, and & binds tighter", () => {
  assert.equal(hits("cw|lw", "2026-08-24"), true);
  assert.equal(hits("cw|lw", "2026-08-17"), true);
  assert.equal(hits("cw|lw", "2026-08-10"), false);

  assert.equal(hits(">=010826&<=150826", "2026-08-10"), true);
  assert.equal(hits(">=010826&<=150826", "2026-08-16"), false);

  // a & b | c is (a & b) or c, so the 1st matches on the second branch only.
  assert.equal(hits(">=100826&<=150826|010826", "2026-08-01"), true);
  assert.equal(hits(">=100826&<=150826|010826", "2026-08-12"), true);
  assert.equal(hits(">=100826&<=150826|010826", "2026-08-20"), false);
});

test("one bad term poisons the whole expression", () => {
  // Half of a filter applied silently is worse than none of it.
  assert.equal(parseDateFilter("cw|garbage", ASOF), null);
  assert.equal(parseDateFilter(">=010826&", ASOF), null);
});

test("+ and - step the term in its own unit", () => {
  // ASOF is Sunday 30 August 2026.
  assert.equal(hits("cd+2", "2026-09-01"), true);
  assert.equal(hits("cd+2", "2026-08-31"), false);
  assert.equal(hits("cd-2", "2026-08-28"), true);

  // A week steps by weeks, a month by months, a year by years - not by days.
  assert.equal(hits("cw+1", "2026-08-31"), true);
  assert.equal(hits("cw+1", "2026-09-06"), true);
  assert.equal(hits("cw+1", "2026-09-07"), false);
  assert.equal(hits("cm+1", "2026-09-30"), true);
  assert.equal(hits("cm+1", "2026-10-01"), false);
  assert.equal(hits("cm-1", "2026-07-15"), true);
  assert.equal(hits("cy+1", "2027-06-01"), true);

  // cm-1 and lm are the same thing said two ways.
  assert.equal(hits("cm-1", "2026-07-01"), hits("lm", "2026-07-01"));
});

test("a typed date steps in days, and a bare step counts from today", () => {
  assert.equal(hits("300826+7", "2026-09-06"), true);
  assert.equal(hits("300826+7", "2026-09-05"), false);
  assert.equal(hits("010926-1", "2026-08-31"), true);
  // Month ends are why this steps by days rather than pretending otherwise.
  assert.equal(hits("310826+1", "2026-09-01"), true);

  assert.equal(hits("+2", "2026-09-01"), true);
  assert.equal(hits("-1", "2026-08-29"), true);
});

test("steps combine with operators and ranges", () => {
  // The next seven days, which is the question that wanted this.
  assert.equal(hits("cd..cd+7", "2026-08-30"), true);
  assert.equal(hits("cd..cd+7", "2026-09-06"), true);
  assert.equal(hits("cd..cd+7", "2026-09-07"), false);
  assert.equal(hits("cd..cd+7", "2026-08-29"), false);

  assert.equal(hits(">=cd+2", "2026-09-01"), true);
  assert.equal(hits(">=cd+2", "2026-08-31"), false);
  assert.equal(hits("<cd-2", "2026-08-27"), true);
  assert.equal(hits("cd+1|cd+3", "2026-09-02"), true);
  assert.equal(hits("cd+1|cd+3", "2026-09-01"), false);
});

test("a step with nothing to step does not parse", () => {
  assert.equal(parseDateFilter("cd+", ASOF), null);
  assert.equal(parseDateFilter("zz+2", ASOF), null);
  assert.equal(parseDateFilter("310226+1", ASOF), null);
});

test("every preset in the menu is something the language can read", () => {
  // The menu writes its expression into the box, so a preset that does not
  // parse would put the box straight into its red state - the one case where
  // red would be the app's fault rather than the typist's.
  for (const preset of DATE_PRESETS) {
    assert.ok(
      parseDateFilter(preset.expr, ASOF),
      `preset "${preset.label}" does not parse: ${preset.expr}`,
    );
  }
});

test("the presets mean what their labels say", () => {
  const expr = (label: string) => DATE_PRESETS.find((p) => p.label === label)!.expr;

  // ASOF is Sunday 30 August 2026, which makes the week boundary worth
  // pinning: its Monday is the 24th and next week starts on the 31st.
  assert.equal(hits(expr("Today"), ASOF), true);
  assert.equal(hits(expr("Tomorrow"), "2026-08-31"), true);
  assert.equal(hits(expr("Next 7 days"), "2026-09-06"), true);
  assert.equal(hits(expr("Next 7 days"), "2026-09-07"), false);
  assert.equal(hits(expr("This week"), "2026-08-24"), true);
  assert.equal(hits(expr("Next week"), "2026-08-31"), true);
  assert.equal(hits(expr("This month"), "2026-08-01"), true);
  assert.equal(hits(expr("From today"), ASOF), true);
  assert.equal(hits(expr("From today"), "2026-08-29"), false);
  assert.equal(hits(expr("Before today"), "2026-08-29"), true);
  assert.equal(hits(expr("Before today"), ASOF), false);
});

test("a row with no date never matches", () => {
  // Unknown is not a match, whatever is being asked.
  assert.equal(hits("cm", ""), false);
  assert.equal(hits("<>cm", ""), false);
  assert.equal(hits(">010101", ""), false);
});

// --- weeks ------------------------------------------------------------------

test("a week runs Monday to Sunday, whichever day you name", () => {
  // 2026-08-30 is a Sunday - the end of its week, not the start of the next.
  assert.equal(mondayOf("2026-08-30"), "2026-08-24");
  assert.equal(mondayOf("2026-08-31"), "2026-08-31");
  assert.equal(mondayOf("2026-08-24"), "2026-08-24");
  assert.equal(sundayOf("2026-08-24"), "2026-08-30");
});

test("an undated line belongs to no week", () => {
  // Not this week. Putting an undated line in the current week would overstate
  // what that week has to be bought for.
  assert.equal(mondayOf(""), "");
  assert.equal(weekNumber(""), 0);
  assert.equal(weekLabel(""), "");
  assert.equal(sundayOf(""), "");
});

test("week numbers follow ISO 8601, including across the new year", () => {
  assert.equal(weekNumber("2026-08-31"), 36);
  assert.equal(weekLabel("2026-08-31"), "w36");
  // 1 January 2027 is a Friday, so its week's Thursday is still in 2026 and
  // the whole week counts as 2026's w53. A naive day-of-year would say w01.
  assert.equal(weekNumber("2027-01-01"), 53);
  // 4 January is always in week 1, by definition of the rule.
  assert.equal(weekNumber("2027-01-04"), 1);
  assert.equal(weekLabel("2026-01-05"), "w02");
});

test("the week you are standing in is not a past week", () => {
  // ASOF is Sunday 30 August, the last day of w35. The week is not over.
  assert.equal(isPastWeek("2026-08-24", ASOF), false);
  assert.equal(isPastWeek("2026-08-17", ASOF), true);
  assert.equal(isPastWeek("2026-08-31", ASOF), false);
});

// --- vendor weeks -----------------------------------------------------------

const VENDOR_NAMES = new Map([["V1", "Advance Flavour Solutions"]]);

function vlines(lines: unknown[], starts: [string, string][] = []) {
  return toVendorLines(
    lines as never,
    new Map([
      ["RMC/1", "V1"],
      ["RMC/2", "V1"],
    ]),
    VENDOR_NAMES,
    new Map(starts),
  );
}

test("the week comes from the order's planned start, not the component due date", () => {
  // The two agree on 1,923 of 1,957 lines. Where they differ the schedule's
  // date wins, or this page would put a job in a different week from the
  // schedule showing the same job.
  const lines = vlines([comp({ dueDate: "2026-09-07" })], [["OLC1", "2026-08-31"]]);
  assert.equal(lines[0].weekStart, "2026-08-31");
});

test("an order with no routing line falls back to the component due date", () => {
  // Dropping the line instead would make it vanish from a page whose whole
  // axis is weeks.
  const lines = vlines([comp({ dueDate: "2026-09-02" })]);
  assert.equal(lines[0].weekStart, "2026-08-31");
});

test("an item with no vendor keeps its line and gets a row of its own", () => {
  const lines = toVendorLines(
    [comp({ itemNo: "RMC/99" })] as never,
    new Map(),
    VENDOR_NAMES,
    new Map([["OLC1", "2026-08-31"]]),
  );
  assert.equal(lines[0].vendorNo, "");
  const groups = groupByVendorWeek(lines, true);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].lineCount, 1);
});

test("a vendor with no card falls back to its code, never to a blank", () => {
  const lines = toVendorLines(
    [comp()] as never,
    new Map([["RMC/1", "V9"]]),
    new Map(),
    new Map([["OLC1", "2026-08-31"]]),
  );
  assert.equal(lines[0].vendorName, "V9");
});

test("lines group into one row per vendor per week", () => {
  const groups = groupByVendorWeek(
    vlines(
      [
        comp({ prodOrderNo: "OLC1", itemNo: "RMC/1" }),
        comp({ prodOrderNo: "OLC2", itemNo: "RMC/2" }),
        comp({ prodOrderNo: "OLC3", itemNo: "RMC/1" }),
      ],
      [
        ["OLC1", "2026-08-31"],
        ["OLC2", "2026-09-02"],
        ["OLC3", "2026-09-07"],
      ],
    ),
    true,
  );
  // OLC1 and OLC2 are the same week; OLC3 is the next.
  assert.equal(groups.length, 2);
  assert.equal(groups[0].weekStart, "2026-08-31");
  assert.equal(groups[0].lineCount, 2);
  assert.equal(groups[0].orderCount, 2);
  assert.equal(groups[0].itemCount, 2);
  assert.equal(groups[1].weekStart, "2026-09-07");
});

test("orders and items are counted distinctly, not summed", () => {
  // Two lines of the same item on the same order is one order and one item,
  // however many lines it takes.
  const groups = groupByVendorWeek(
    vlines([comp({ lineNo: 10000 }), comp({ lineNo: 20000 })], [["OLC1", "2026-08-31"]]),
    true,
  );
  assert.equal(groups[0].lineCount, 2);
  assert.equal(groups[0].orderCount, 1);
  assert.equal(groups[0].itemCount, 1);
});

test("weeks sort earliest first, and undated rows sort last", () => {
  const groups = groupByVendorWeek(
    [
      ...vlines([comp({ prodOrderNo: "OLC2" })], [["OLC2", "2026-09-07"]]),
      ...vlines([comp({ prodOrderNo: "OLC3", dueDate: null })]),
      ...vlines([comp({ prodOrderNo: "OLC1" })], [["OLC1", "2026-08-31"]]),
    ],
    true,
  );
  assert.deepEqual(
    groups.map((g) => g.weekStart),
    ["2026-08-31", "2026-09-07", ""],
  );
});

test("within a week the biggest commitment leads", () => {
  // A buyer opens the page to see what to chase, not who sorts first.
  const lines = [
    ...toVendorLines(
      [comp({ prodOrderNo: "A", itemNo: "X" })] as never,
      new Map([["X", "V-SMALL"]]),
      new Map([["V-SMALL", "Aardvark Ltd"]]),
      new Map([["A", "2026-08-31"]]),
    ),
    ...toVendorLines(
      [comp({ prodOrderNo: "B", itemNo: "Y" }), comp({ prodOrderNo: "C", itemNo: "Y" })] as never,
      new Map([["Y", "V-BIG"]]),
      new Map([["V-BIG", "Zebra Ltd"]]),
      new Map([
        ["B", "2026-08-31"],
        ["C", "2026-09-01"],
      ]),
    ),
  ];
  const groups = groupByVendorWeek(lines, true);
  assert.equal(groups[0].vendorName, "Zebra Ltd");
  assert.equal(groups[0].lineCount, 2);
});

test("nothing is called short when the stock feed is partial", () => {
  const short = vlines([comp({ remainingQuantity: 100, available: 0 })], [["OLC1", "2026-08-31"]]);
  assert.equal(groupByVendorWeek(short, true)[0].shortLines, 1);
  assert.equal(groupByVendorWeek(short, false)[0].shortLines, 0);
});

test("only a short line's delivery date counts as the next delivery", () => {
  // A covered line has an incoming PO too, and showing its date would read as
  // waiting on a delivery when nothing is being waited on.
  const covered = vlines(
    [comp({ remainingQuantity: 10, available: 500, nextReceipt: "2026-09-01" })],
    [["OLC1", "2026-08-31"]],
  );
  assert.equal(groupByVendorWeek(covered, true)[0].nextReceipt, null);
});

test("fully picked holds only when every line is", () => {
  const mixed = vlines(
    [comp({ completelyPicked: true }), comp({ prodOrderNo: "OLC2", completelyPicked: false })],
    [
      ["OLC1", "2026-08-31"],
      ["OLC2", "2026-09-01"],
    ],
  );
  const group = groupByVendorWeek(mixed, true)[0];
  assert.equal(group.pickedLines, 1);
  assert.equal(group.fullyPicked, false);
});

test("the vendor list totals lines across every week", () => {
  const groups = groupByVendorWeek(
    vlines(
      [comp({ prodOrderNo: "OLC1" }), comp({ prodOrderNo: "OLC2" })],
      [
        ["OLC1", "2026-08-31"],
        ["OLC2", "2026-09-07"],
      ],
    ),
    true,
  );
  const list = vendorsIn(groups);
  assert.equal(list.length, 1);
  assert.equal(list[0].lines, 2);
  assert.equal(list[0].name, "Advance Flavour Solutions");
});

// --- paging through weeks ---------------------------------------------------

test("the week pager opens on the week you are standing in", () => {
  // ASOF is Sunday 30 August - the LAST day of w35, which starts 24 August.
  // Landing on w36 because the Monday has passed would skip the week whose
  // deliveries are still live.
  const weeks = ["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"];
  assert.equal(initialWeekIndex(weeks, ASOF), 2);
  assert.equal(weeks[initialWeekIndex(weeks, ASOF)], "2026-08-24");
});

test("with no current week, the pager opens on the next one with work", () => {
  // Not the earliest. On the real board that is a single stalled June order,
  // week 1 of 11, eight clicks from the week anyone came to look at.
  const weeks = ["2026-06-29", "2026-07-27", "2026-09-07", "2026-09-14"];
  assert.equal(weeks[initialWeekIndex(weeks, ASOF)], "2026-09-07");
});

test("when every week is behind, the pager opens on the most recent", () => {
  const weeks = ["2026-06-29", "2026-07-27", "2026-08-03"];
  assert.equal(weeks[initialWeekIndex(weeks, ASOF)], "2026-08-03");
});

test("an undated bucket is never a landing place", () => {
  // It answers a different question from any real week, and opening on it
  // would show a page that looks empty of scheduled work.
  assert.equal(initialWeekIndex(["", "2026-09-07"], ASOF), 1);
  // Even when it is all there is, the index stays in range.
  assert.equal(initialWeekIndex([""], ASOF), 0);
  assert.equal(initialWeekIndex([], ASOF), 0);
});

test("the week list is every week in the data, undated last", () => {
  const lines = toVendorLines(
    [
      comp({ prodOrderNo: "B" }),
      comp({ prodOrderNo: "C", dueDate: null }),
      comp({ prodOrderNo: "A" }),
      comp({ prodOrderNo: "D" }),
    ] as never,
    new Map([["RMC/1", "V1"]]),
    new Map(),
    new Map([
      ["A", "2026-08-31"],
      ["B", "2026-09-07"],
      ["D", "2026-08-31"],
    ]),
  );
  // D shares A's week, so three lines make two weeks plus the undated one.
  assert.deepEqual(weeksIn(lines), ["2026-08-31", "2026-09-07", ""]);
});

test("a week range writes the year once, and the month only when it changes", () => {
  assert.equal(formatWeekRange("2026-08-03", "2026-08-09"), "3 - 9 Aug 2026");
  assert.equal(formatWeekRange("2026-08-31", "2026-09-06"), "31 Aug - 6 Sep 2026");
  assert.equal(formatWeekRange("2026-12-28", "2027-01-03"), "28 Dec - 3 Jan 2027");
  assert.equal(formatWeekRange("", ""), "");
});

// --- items inside a vendor week ---------------------------------------------

/** Lines for one vendor, one week, ready to group by item. */
function ilines(over: Record<string, unknown>[]) {
  return toVendorLines(
    over.map((o) => comp(o)) as never,
    new Map([
      ["RMC/1", "V1"],
      ["RMC/2", "V1"],
    ]),
    new Map([["V1", "Advance Flavour Solutions"]]),
    new Map(),
  );
}

test("a vendor week collapses to one row per item, with the quantity summed", () => {
  // A purchase order has one line per item, not one per production order.
  const items = groupLinesByItem(
    ilines([
      { prodOrderNo: "A", itemNo: "RMC/1", remainingQuantity: 143 },
      { prodOrderNo: "B", itemNo: "RMC/1", remainingQuantity: 143 },
      { prodOrderNo: "C", itemNo: "RMC/2", remainingQuantity: 26 },
    ]),
    true,
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].itemNo, "RMC/1");
  assert.equal(items[0].remaining, 286);
  assert.equal(items[0].orderCount, 2);
  assert.equal(items[0].lines.length, 2);
});

test("stock is counted once per item, never summed across its lines", () => {
  // THE reason to group by item. Every line of an item carries the same free
  // stock, because it is the item's stock and not the line's share of it.
  // Four lines at 150 must not report 600 on the shelf.
  const items = groupLinesByItem(
    ilines([
      { prodOrderNo: "A", itemNo: "RMC/1", remainingQuantity: 143, available: 150 },
      { prodOrderNo: "B", itemNo: "RMC/1", remainingQuantity: 143, available: 150 },
      { prodOrderNo: "C", itemNo: "RMC/1", remainingQuantity: 143, available: 150 },
      { prodOrderNo: "D", itemNo: "RMC/1", remainingQuantity: 143, available: 150 },
    ]),
    true,
  );
  assert.equal(items[0].available, 150);
  assert.equal(items[0].remaining, 572);
});

test("shortfall is the week's demand against one pool of stock", () => {
  // Line by line, each of these four orders sees the same 150 and decides it
  // is covered, so nothing looks short while the week is 422 down. Compared
  // once, it is short.
  const lines = ilines([
    { prodOrderNo: "A", itemNo: "RMC/1", remainingQuantity: 143, available: 150 },
    { prodOrderNo: "B", itemNo: "RMC/1", remainingQuantity: 143, available: 150 },
    { prodOrderNo: "C", itemNo: "RMC/1", remainingQuantity: 143, available: 150 },
    { prodOrderNo: "D", itemNo: "RMC/1", remainingQuantity: 143, available: 150 },
  ]);
  // Not one line is short on its own.
  assert.equal(lines.filter((l) => l.available < l.remainingQuantity).length, 0);
  assert.equal(groupLinesByItem(lines, true)[0].shortBy, 422);
});

test("an item with enough stock is not short, and has no delivery to wait for", () => {
  const items = groupLinesByItem(
    ilines([
      { itemNo: "RMC/1", remainingQuantity: 26, available: 208, nextReceipt: "2026-09-10" },
    ]),
    true,
  );
  assert.equal(items[0].shortBy, 0);
  // The item has an incoming PO, but showing its date would read as waiting on
  // a delivery when nothing is being waited on.
  assert.equal(items[0].nextReceipt, null);
});

test("nothing is called short when the stock feed is partial", () => {
  const lines = ilines([{ itemNo: "RMC/1", remainingQuantity: 500, available: 0 }]);
  assert.equal(groupLinesByItem(lines, true)[0].shortBy, 500);
  assert.equal(groupLinesByItem(lines, false)[0].shortBy, 0);
});

test("short items lead, then the biggest quantity, then item number", () => {
  const items = groupLinesByItem(
    ilines([
      { prodOrderNo: "A", itemNo: "RMC/2", remainingQuantity: 900, available: 9000 },
      { prodOrderNo: "B", itemNo: "RMC/1", remainingQuantity: 10, available: 0 },
    ]),
    true,
  );
  // The small short one beats the large covered one - it is what needs acting
  // on, which is the whole reason a buyer opened the row.
  assert.deepEqual(items.map((i) => i.itemNo), ["RMC/1", "RMC/2"]);
});

test("the earliest need across an item's orders is the one shown", () => {
  const items = groupLinesByItem(
    ilines([
      { prodOrderNo: "A", itemNo: "RMC/1", dueDate: "2026-09-04" },
      { prodOrderNo: "B", itemNo: "RMC/1", dueDate: "2026-09-01" },
    ]),
    true,
  );
  assert.equal(items[0].earliestNeeded, "2026-09-01");
});

// --- filtering the week pager by date ---------------------------------------

const WEEKS = [
  "2026-07-27",
  "2026-08-03",
  "2026-08-10",
  "2026-08-17",
  "2026-08-24",
  "2026-08-31",
  "2026-09-07",
];

/** The date language, compiled against ASOF - what the box hands over. */
function pick(expr: string) {
  const match = parseDateFilter(expr, ASOF);
  assert.ok(match, `expression did not parse: ${expr}`);
  return weeksMatching(WEEKS, match!);
}

test("a week holds seven days, Monday first", () => {
  assert.deepEqual(daysOf("2026-08-24"), [
    "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27",
    "2026-08-28", "2026-08-29", "2026-08-30",
  ]);
  assert.deepEqual(daysOf(""), []);
});

test("one typed date finds the week containing it, not the week starting on it", () => {
  // 30 August is a SUNDAY. Matching on the Monday alone would find nothing and
  // leave the pager empty on a date the user can see work for.
  assert.deepEqual(pick("300826"), ["2026-08-24"]);
  // A Monday still works, obviously.
  assert.deepEqual(pick("240826"), ["2026-08-24"]);
  // And a Wednesday in the middle.
  assert.deepEqual(pick("260826"), ["2026-08-24"]);
});

test("a period filters the pager to every week it touches", () => {
  // August, so the weeks that straddle both ends come too - they contain
  // August days and their material is bought in August.
  assert.deepEqual(pick("cm"), [
    "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31",
  ]);
  // The next seven days from Sunday 30 August run to Saturday 6 September,
  // which is the last day of w36 - so w37 is correctly outside it.
  assert.deepEqual(pick("cd..cd+7"), ["2026-08-24", "2026-08-31"]);
});

test("comparisons and unions narrow the weeks too", () => {
  assert.deepEqual(pick(">=010926"), ["2026-08-31", "2026-09-07"]);
  assert.deepEqual(pick("cw|cw+1"), ["2026-08-24", "2026-08-31"]);
});

test("the undated bucket never matches a date filter", () => {
  // A date filter asks "when", and "no date" is not an answer to it.
  const match = parseDateFilter("cm", ASOF)!;
  assert.deepEqual(weeksMatching(["", "2026-08-03"], match), ["2026-08-03"]);
});

test("the span of the filtered weeks is whole weeks, not the days asked for", () => {
  // Someone who asked for August is looking at six whole weeks. Reporting
  // 1-31 August would describe a narrower period than what is on screen.
  assert.deepEqual(weekSpan(pick("cm")), { from: "2026-07-27", to: "2026-09-06" });
  assert.deepEqual(weekSpan(["2026-08-24"]), { from: "2026-08-24", to: "2026-08-30" });
  assert.equal(weekSpan([]), null);
  assert.equal(weekSpan([""]), null);
});

// --- units ------------------------------------------------------------------

test("a vendor week in one unit reports that unit", () => {
  const groups = groupByVendorWeek(
    vlines(
      [comp({ prodOrderNo: "A", remainingQuantity: 26, unitOfMeasureCode: "KG" })],
      [["A", "2026-08-31"]],
    ),
    true,
  );
  assert.deepEqual(groups[0].units, [{ code: "KG", quantity: 26 }]);
});

test("a vendor week in two units is split, never added", () => {
  // The real case: Rule 13 Ltd in w33 is 94,500 EACH plus 1,047 KG, which a
  // plain sum reported as 95,547 of nothing in particular.
  const groups = groupByVendorWeek(
    vlines(
      [
        comp({ prodOrderNo: "A", remainingQuantity: 94500, unitOfMeasureCode: "EACH" }),
        comp({ prodOrderNo: "B", remainingQuantity: 1047, unitOfMeasureCode: "KG" }),
      ],
      [["A", "2026-08-31"], ["B", "2026-08-31"]],
    ),
    true,
  );
  // Biggest first, so the headline figure leads.
  assert.deepEqual(groups[0].units, [
    { code: "EACH", quantity: 94500 },
    { code: "KG", quantity: 1047 },
  ]);
  // The sum still exists, because the column has to sort on something.
  assert.equal(groups[0].remaining, 95547);
});

// --- compact quantities -----------------------------------------------------

test("kilos become tonnes once there are a thousand of them", () => {
  assert.equal(compactQuantity(12681.926, "KG"), "12.68 t");
  assert.equal(compactQuantity(1047, "KG"), "1.05 t");
  assert.equal(compactQuantity(250000, "KG"), "250 t");
  // Below a tonne there is nothing to shorten, and the exact figure is more
  // use than a decimal of it.
  assert.equal(compactQuantity(926, "KG"), "926 (KG)");
  assert.equal(compactQuantity(0, "KG"), "0 (KG)");
});

test("counts take a k or M suffix and keep their own unit", () => {
  // There is no larger unit of bottle, so EACH stays EACH.
  assert.equal(compactQuantity(621073, "EACH"), "621k (EACH)");
  assert.equal(compactQuantity(35248, "EACH"), "35.2k (EACH)");
  assert.equal(compactQuantity(13899, "EACH"), "13.9k (EACH)");
  assert.equal(compactQuantity(107865, "EACH"), "108k (EACH)");
  assert.equal(compactQuantity(288000, "EACH"), "288k (EACH)");
  assert.equal(compactQuantity(800, "EACH"), "800 (EACH)");
  assert.equal(compactQuantity(1250000, "EACH"), "1.25M (EACH)");
  assert.equal(compactQuantity(24500000, "EACH"), "24.5M (EACH)");
});

test("trailing zeros are dropped, so 12.50 reads as 12.5", () => {
  assert.equal(compactQuantity(12500, "KG"), "12.5 t");
  assert.equal(compactQuantity(20000, "KG"), "20 t");
  assert.equal(compactQuantity(100000, "EACH"), "100k (EACH)");
});

test("every value reads at about three significant figures", () => {
  // Which is the point: two weeks that differ enough to matter must not round
  // to the same string. 621k and 622k stay apart; 621,073 and 621,140 do not,
  // and that difference does not change a decision.
  assert.notEqual(compactQuantity(621073, "EACH"), compactQuantity(622000, "EACH"));
  assert.notEqual(compactQuantity(35248, "EACH"), compactQuantity(35900, "EACH"));
});

// --- component descriptions -------------------------------------------------

test("a component line with no description borrows the item's", () => {
  // BC copies the item's description onto the line when the line is created,
  // and on 147 of 1,957 lines that copy is blank while the item card has one
  // for every single item involved. A blank there is a stale copy, not a
  // missing name, so the column should not be empty.
  const line = toComponentLine(
    comp({ itemNo: "RMC/109839", description: "" }) as never,
    new Map([["RMC/109839", "BAX CARAMEL TOBACCO 20MG CARTON"]]),
  );
  assert.equal(line.description, "BAX CARAMEL TOBACCO 20MG CARTON");
});

test("the line's own description wins when it has one", () => {
  // It is what BC printed on the works order, so the floor is reading it.
  const line = toComponentLine(
    comp({ itemNo: "RMC/1", description: "AS PRINTED" }) as never,
    new Map([["RMC/1", "AS ON THE ITEM CARD"]]),
  );
  assert.equal(line.description, "AS PRINTED");
});

test("an item missing from the map leaves a blank, not undefined", () => {
  const line = toComponentLine(comp({ description: "" }) as never, new Map());
  assert.equal(line.description, "");
});

// --- export file names ------------------------------------------------------

test("an unfiltered export keeps the plain name", () => {
  assert.equal(
    exportFileName("vendors-2026-08-24", [], "2026-08-30"),
    "vendors-2026-08-24-2026-08-30.xlsx",
  );
});

test("a filtered export names what narrowed it", () => {
  // The point: a workbook holding one supplier should say so, or two of them
  // in a downloads folder are indistinguishable.
  assert.equal(
    exportFileName("vendors-2026-08-24", ["Advance Flavour Solutions"], "2026-08-30"),
    "vendors-2026-08-24-Advance-Flavour-Solutions-2026-08-30.xlsx",
  );
});

test("punctuation never reaches the file name", () => {
  // Windows rejects half of it, and "Sone Products Ltd." would otherwise ship
  // a full stop into the middle of a name.
  assert.equal(
    exportFileName("vendors", ["Sone Products Ltd."], "2026-08-30"),
    "vendors-Sone-Products-Ltd-2026-08-30.xlsx",
  );
  assert.equal(
    exportFileName("vendors", ["PROD-1 / PROD-2"], "2026-08-30"),
    "vendors-PROD-1-PROD-2-2026-08-30.xlsx",
  );
  // A value that is nothing but punctuation contributes nothing rather than a
  // run of hyphens.
  assert.equal(exportFileName("vendors", ["***"], "2026-08-30"), "vendors-2026-08-30.xlsx");
});

test("two filters are named; three become \"filtered\"", () => {
  assert.equal(
    exportFileName("components", ["PROD-1", "OLCRELPROD100"], "2026-08-30"),
    "components-PROD-1-OLCRELPROD100-2026-08-30.xlsx",
  );
  // A file name that needs scrolling is no more use than one that says nothing.
  assert.equal(
    exportFileName("components", ["PROD-1", "OLCRELPROD100", "KG"], "2026-08-30"),
    "components-filtered-2026-08-30.xlsx",
  );
});

test("a long value is cut short, and never cut to a trailing hyphen", () => {
  const name = exportFileName(
    "vendors",
    ["Excel Packaging Machinery Limited"],
    "2026-08-30",
  );
  // 28 characters of it: "Excel-Packaging-Machinery-Li".
  assert.equal(name, "vendors-Excel-Packaging-Machinery-Li-2026-08-30.xlsx");
  assert.ok(!name.includes("--"), "no doubled hyphen where the cut landed");
});
