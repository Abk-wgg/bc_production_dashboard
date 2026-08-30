// Pins the row mappers to the field names the published web services actually
// send.
//
// This is the file that would have caught the bug it was written after: the
// routing feed sends "Starting Date-Time", the mapper read "Starting Date", and
// the result was not an error but an empty schedule. A wrong field name here is
// always silent, so the only defence is to assert the real names.
//
// The rows below use the column names from the live feeds, recorded in
// `BC-WAREHOUSE - Raw data/output/_headers.json`, put through the same rename
// BC applies when a page is published: full stops dropped, every other
// non-alphanumeric to an underscore.

import test from "node:test";
import assert from "node:assert/strict";

import {
  toProductionOrder,
  toComponent,
  toRoutingLine,
  toOutputEvent,
  toStockLot,
  toPurchaseLine,
  toSalesOrder,
} from "../src/lib/bc/map.ts";
import { RELEASED } from "../src/lib/status.ts";
import { MANUAL } from "../src/lib/scope.ts";

test("production order reads the published Date-Time columns", () => {
  const order = toProductionOrder({
    No: "OLCRELPROD100",
    Status: "3",
    Location_Code: "PRODUCTION",
    Description: "OLC NERD 10ML VMT 20MG",
    Source_No: "ELN-OLC-S10-VMT-20M",
    Sales_Order_No: "OLCSO-77",
    Routing_No: "ERROR_ROUTE",
    Quantity: "14690",
    Finished_Quantity: "0",
    // The published page has no plain Starting/Ending Date - only these.
    Starting_Date_Time: "2026-09-08T07:00:00Z",
    Ending_Date_Time: "2026-09-09T15:00:00Z",
    Due_Date: "2026-09-10",
    Brand: "FEAST TREATS",
    Flavour: "VMT",
    Strength: "20MG",
    Cartoned: "YES",
    Completely_Picked: "false",
    NETVAPS_Scheduled: "true",
  });

  assert.equal(order.no, "OLCRELPROD100");
  assert.equal(order.status, RELEASED);
  assert.equal(order.locationCode, "PRODUCTION");
  assert.equal(order.quantity, 14690);
  assert.equal(order.startingDate, "2026-09-08");
  assert.equal(order.endingDate, "2026-09-09");
  assert.equal(order.dueDate, "2026-09-10");
  assert.equal(order.salesOrderNo, "OLCSO-77");
  assert.equal(order.brand, "FEAST TREATS");
  assert.equal(order.flavour, "VMT");
  assert.equal(order.strength, "20MG");
  assert.equal(order.scheduled, true);
});

test("routing line reads Starting Date-Time — the schedule depends on it", () => {
  const line = toRoutingLine({
    Status: "3",
    Prod_Order_No: "OLCRELPROD100",
    Operation_No: "1000",
    Type: "0",
    No: "PROD-3",
    Description: "PRODUCTION-3",
    Location_Code: "PRODUCTION",
    Routing_No: "ERROR_ROUTE",
    Routing_Status: "",
    Starting_Date_Time: "2026-09-08T07:00:00Z",
    Ending_Date_Time: "2026-09-09T15:00:00Z",
    Setup_Time: "0",
    Run_Time: "0",
  });

  assert.equal(line.prodOrderNo, "OLCRELPROD100");
  assert.equal(line.no, "PROD-3");
  // Without this the day-by-day board has nothing to group on.
  assert.equal(line.startingDate, "2026-09-08");
  assert.equal(line.endingDate, "2026-09-09");
});

test("routing line survives Work Center No. not being published", () => {
  // The published page carries only `No.`. The PRINTING exclusion checks both,
  // so the missing one must map to "" rather than undefined.
  const line = toRoutingLine({ Prod_Order_No: "A", No: "PRINTING" });
  assert.equal(line.workCenterNo, "");
  assert.equal(line.no, "PRINTING");
});

test("component reads the (Base) pick quantities and falls back for Line No.", () => {
  const component = toComponent({
    Status: "3",
    Prod_Order_No: "OLCRELPROD100",
    Prod_Order_Line_No: "10000",
    Item_No: "RMC/100737",
    Description: "10ML PET CLEAR BOTTLE",
    Location_Code: "PRODUCTION",
    Bin_Code: "PRODFLOORBIN",
    Quantity_per: "1",
    Expected_Quantity: "14690",
    Remaining_Quantity: "14690",
    Due_Date: "2026-09-10",
    // The published page sends the (Base) variants, and no plain "Line No.".
    Pick_Qty_Base: "0",
    Qty_Picked_Base: "500",
    Completely_Picked: "false",
    Flushing_Method: "0",
  });

  assert.equal(component.prodOrderNo, "OLCRELPROD100");
  assert.equal(component.itemNo, "RMC/100737");
  assert.equal(component.remainingQuantity, 14690);
  assert.equal(component.qtyPicked, 500);
  assert.equal(component.flushingMethod, MANUAL);
  // No "Line No." on the feed, so it borrows the order line - a row numbered 0
  // would also collide as a React key.
  assert.equal(component.lineNo, 10000);
});

test("stock lot reads the published names, not the PB365-prefixed table ones", () => {
  const lot = toStockLot({
    Item_No: "SAL-08469.1",
    Item_Description: "2.0% W/V NICOTINE SALICYLATE 70:30",
    Lot_No: "8469.1/AH",
    Item_Category_Code: "LIQUID",
    Location_Code: "PRODUCTION",
    Bin_Code: "PRODFLOORBIN",
    Quantity_Base: "22",
    Avail_Qty_Base: "22",
    Base_Unit_of_Measure_Code: "KG",
    // Published without the PB365_LM_ prefix the table field carries.
    Status: "RELEASED",
    Expiration_Date: "2028-07-21",
    Date_of_Entry: "2026-07-31",
  });

  assert.equal(lot.itemNo, "SAL-08469.1");
  assert.equal(lot.availableQuantity, 22);
  assert.equal(lot.expiryDate, "2028-07-21");
  assert.equal(lot.lotStatus, "RELEASED");
  // "Available" is not published; absent must not mean "no usable stock".
  assert.equal(lot.available, true);
});

test("purchase line reads promised and expected receipt dates", () => {
  const line = toPurchaseLine({
    Document_Type: "1",
    Document_No: "OLCPO-1",
    Buy_from_Vendor_No: "V001",
    No: "RMC/100737",
    Description: "10ML PET CLEAR BOTTLE",
    Location_Code: "PRODUCTION",
    Quantity: "50000",
    Outstanding_Quantity: "20000",
    Quantity_Received: "30000",
    Expected_Receipt_Date: "2026-09-20",
    Promised_Receipt_Date: "2026-09-25",
    Unit_of_Measure_Code: "EA",
  });

  assert.equal(line.itemNo, "RMC/100737");
  assert.equal(line.vendorNo, "V001");
  assert.equal(line.outstandingQuantity, 20000);
  assert.equal(line.promisedReceiptDate, "2026-09-25");
  assert.equal(line.expectedReceiptDate, "2026-09-20");
  // "Completely Received" is not on the feed - absent must not read as received.
  assert.equal(line.completelyReceived, false);
});

test("sales order reads the hyphenated customer columns", () => {
  // "Sell-to Customer Name" becomes Sell_to_Customer_Name, not
  // Sell-to_Customer_Name. Getting this wrong blanked every customer.
  const order = toSalesOrder({
    No: "OLCSO-77",
    Sell_to_Customer_No: "C001",
    Sell_to_Customer_Name: "The Ecig Store Ltd (Feast Treats)",
    External_Document_No: "PO-9912",
    Location_Code: "PRODUCTION",
    Document_Date: "2026-08-01",
    Status: "1",
    Completely_Shipped: "false",
    Amount: "5950",
    Amount_Including_VAT: "7140",
  });

  assert.equal(order.no, "OLCSO-77");
  assert.equal(order.customerName, "The Ecig Store Ltd (Feast Treats)");
  assert.equal(order.amount, 5950);
  assert.equal(order.completelyShipped, false);
});

test("output event reads the shop-floor columns", () => {
  const event = toOutputEvent({
    Entry_No: "7",
    Production_Order_No: "OLCRELPROD733",
    Source_No: "ELD-OLC-S10-MBE-03M",
    Button_Event: "Complete",
    Event_Type: "Output",
    DateTime: "2026-08-03T06:06:14.097Z",
    Line_Leader: "Esther Cheng",
    Qty_Output: "903",
    Qty_Scrapped: "0",
    Booked: "true",
  });

  assert.equal(event.prodOrderNo, "OLCRELPROD733");
  assert.equal(event.eventType, "Output");
  assert.equal(event.qtyOutput, 903);
  assert.equal(event.booked, true);
  // Drives the Floor column and the name beside it.
  assert.equal(event.buttonEvent, "Complete");
  assert.equal(event.lineLeader, "Esther Cheng");
});

test("an event with no Line Leader reads as blank, not undefined", () => {
  // The snapshot leaves the column out - it is an employee name in a file that
  // leaves the server. The floor status still has to work without it.
  const event = toOutputEvent({ Production_Order_No: "A", Button_Event: "Start" });
  assert.equal(event.lineLeader, "");
});

test("a reversal keeps its negative sign through the mapper", () => {
  // The sign is the whole mechanism for corrections - see buildProgressMap.
  const event = toOutputEvent({ Event_Type: "Output", Qty_Output: "-903" });
  assert.equal(event.qtyOutput, -903);
});
