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
import { formatDate, formatLineNo } from "../src/lib/format.ts";
import { safeCallbackUrl } from "../src/lib/safe-redirect.ts";
import { groupByOrder, isShort, shortfallOf } from "../src/lib/component-groups.ts";
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
  // A Complete is a booking - output, consumption or scrap - not the end of the
  // order. BC's Finished status answers that, and it is a different question.
  assert.equal(floorStatusOf("Complete"), "running");
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
  assert.deepEqual(counts, { running: 1, paused: 1, "qa-booked": 0, "not-started": 1 });
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
