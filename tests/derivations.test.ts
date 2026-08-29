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

import { buildWorkCenterMap, categorise, orderHasCategory, withWorkCenters } from "../src/lib/work-center.ts";
import { groupByDay, toWorkCenterColumns, NO_DATE } from "../src/lib/schedule.ts";
import { isOutstanding, isOverdue, isDueSoon, summarise } from "../src/lib/board.ts";
import { toStatus, statusName, RELEASED, FINISHED } from "../src/lib/status.ts";
import { formatDate, formatLineNo } from "../src/lib/format.ts";
import type { ProductionOrder, ProdOrderRoutingLine } from "../src/lib/types.ts";

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

test("PROD* is production, anything else is trade", () => {
  assert.equal(categorise("PROD1"), "production");
  assert.equal(categorise("prod-line-2"), "production");
  assert.equal(categorise("TRADE1"), "trade");
  assert.equal(categorise(""), "unassigned");
  assert.equal(orderHasCategory("TRADE1, PROD1", "production"), true);
  assert.equal(orderHasCategory("TRADE1", "production"), false);
});

test("days sort ascending with undated orders last", () => {
  const days = groupByDay(
    withWorkCenters(
      [
        order({ no: "B", dueDate: "2026-09-11" }),
        order({ no: "C", dueDate: null }),
        order({ no: "A", dueDate: "2026-09-10" }),
      ],
      [],
    ),
  );
  assert.deepEqual(
    days.map((d) => d.key),
    ["2026-09-10", "2026-09-11", NO_DATE],
  );
});

test("columns order production first, then trade, then unassigned", () => {
  const orders = withWorkCenters(
    [order({ no: "A" }), order({ no: "B" }), order({ no: "C" })],
    [
      line({ prodOrderNo: "A", no: "PROD1" }),
      line({ prodOrderNo: "B", no: "TRADE1", workCenterNo: "TRADE1" }),
      // C has no routing line at all.
    ],
  );
  const columns = toWorkCenterColumns(orders, null);
  assert.deepEqual(
    columns.map((c) => c.category),
    ["production", "trade", "unassigned"],
  );
});

test("an order spanning two centres appears in both columns", () => {
  const orders = withWorkCenters(
    [order({ no: "A" })],
    [line({ prodOrderNo: "A", no: "PROD1" }), line({ prodOrderNo: "A", no: "TRADE1", workCenterNo: "TRADE1" })],
  );
  const columns = toWorkCenterColumns(orders, null);
  assert.deepEqual(columns.map((c) => c.workCenter), ["PROD1", "TRADE1"]);
  assert.equal(columns[0].orders[0].no, "A");
  assert.equal(columns[1].orders[0].no, "A");
});

test("filtering to one category drops the other centre's column", () => {
  const orders = withWorkCenters(
    [order({ no: "A" })],
    [line({ prodOrderNo: "A", no: "PROD1" }), line({ prodOrderNo: "A", no: "TRADE1", workCenterNo: "TRADE1" })],
  );
  const columns = toWorkCenterColumns(orders, "production");
  assert.deepEqual(columns.map((c) => c.workCenter), ["PROD1"]);
});

test("outstanding is driven by status, never by finishedQuantity", () => {
  // The whole point: a finished order with finishedQuantity 0 is still finished.
  assert.equal(isOutstanding(order({ status: FINISHED, finishedQuantity: 0 })), false);
  assert.equal(isOutstanding(order({ status: RELEASED, finishedQuantity: 0 })), true);
});

test("overdue needs an outstanding order with a due date in the past", () => {
  const asOf = "2026-09-10";
  assert.equal(isOverdue(order({ dueDate: "2026-09-09" }), asOf), true);
  assert.equal(isOverdue(order({ dueDate: "2026-09-10" }), asOf), false);
  assert.equal(isOverdue(order({ dueDate: null }), asOf), false);
  assert.equal(isOverdue(order({ dueDate: "2026-09-09", status: FINISHED }), asOf), false);
});

test("due soon spans today to seven days out inclusive", () => {
  const asOf = "2026-09-10";
  assert.equal(isDueSoon(order({ dueDate: "2026-09-10" }), asOf), true);
  assert.equal(isDueSoon(order({ dueDate: "2026-09-17" }), asOf), true);
  assert.equal(isDueSoon(order({ dueDate: "2026-09-18" }), asOf), false);
});

test("summary counts outstanding work, not every row", () => {
  const summary = summarise(
    [
      order({ no: "A", dueDate: "2026-09-09", quantity: 100 }),
      order({ no: "B", status: FINISHED, quantity: 999 }),
      order({ no: "C", dueDate: "2026-09-12", quantity: 50, scheduled: false }),
    ],
    "2026-09-10",
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.outstanding, 2);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueSoon, 1);
  assert.equal(summary.unscheduled, 1);
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
