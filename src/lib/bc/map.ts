// Row mappers: one raw OData row in, one typed row out.
//
// Deliberately NOT `server-only`. These are pure functions, and keeping them
// out of the server-only modules is what makes them testable - the field names
// below are the single most breakage-prone thing in the app, because a wrong
// one produces a blank column rather than an error. tests/mappers.test.ts pins
// them against the real published headers.
//
// Publishing a BC page as a web service RENAMES its fields: full stops are
// dropped and every other non-alphanumeric becomes an underscore, so
// "Sales Order No." arrives as "Sales_Order_No" and "Starting Date-Time" as
// "Starting_Date_Time". Which spelling you get depends on which page was
// published, so each mapper tries the known ones in order.

import type {
  Item,
  OutputEvent,
  ProdOrderComponent,
  ProdOrderRoutingLine,
  ProductionOrder,
  PurchaseLine,
  SalesLine,
  SalesOrder,
  StockLot,
  Vendor,
} from "../types";
import { pick, toBool, toDate, toNumber, toText, type RawRow } from "./fields";
import { toStatus } from "../status";
import { toFlushingMethod } from "../scope";

export function toProductionOrder(row: RawRow): ProductionOrder {
  return {
    no: toText(pick(row, "No", "No.", "No_")),
    status: toStatus(pick(row, "Status")),
    description: toText(pick(row, "Description")),
    itemNo: toText(pick(row, "Source_No", "Source No.", "SourceNo")),
    routingNo: toText(pick(row, "Routing_No", "RoutingNo")),
    quantity: toNumber(pick(row, "Quantity")),
    finishedQuantity: toNumber(pick(row, "Finished_Quantity", "FinishedQuantity")),
    dueDate: toDate(pick(row, "Due_Date", "DueDate")),
    // The published page exposes Starting/Ending DATE-TIME, not the plain date
    // fields on the table. toDate() trims the time part.
    startingDate: toDate(pick(row, "Starting_Date_Time", "Starting_Date", "StartingDate")),
    endingDate: toDate(pick(row, "Ending_Date_Time", "Ending_Date", "EndingDate")),
    finishedDate: toDate(pick(row, "Finished_Date", "FinishedDate")),
    locationCode: toText(pick(row, "Location_Code", "LocationCode")),
    assignedUserId: toText(pick(row, "Assigned_User_ID", "AssignedUserID", "AssignedUserId")),
    brand: toText(pick(row, "Brand")),
    salesOrderNo: toText(pick(row, "Sales_Order_No", "SalesOrderNo")),
    scheduled: toBool(pick(row, "NETVAPS_Scheduled", "NETVAPSScheduled")),
    completelyPicked: toBool(pick(row, "Completely_Picked", "CompletelyPicked")),
    // This tenant carries flavour and strength as the first two of ten generic
    // "Attribute ID" fields on 5405 - Attribute_ID_1 reads "Vmt", _2 reads
    // "20Mg". The plain names are tried first in case a page ever exposes them.
    flavour: toText(pick(row, "Flavour", "Attribute_ID_1", "AttributeID1")),
    strength: toText(pick(row, "Strength", "Attribute_ID_2", "AttributeID2")),
    cartoned: toText(pick(row, "Cartoned")),
  };
}

export function toComponent(row: RawRow): ProdOrderComponent {
  return {
    prodOrderNo: toText(pick(row, "Prod_Order_No", "ProdOrderNo", "Prod. Order No.")),
    prodOrderLineNo: toNumber(pick(row, "Prod_Order_Line_No", "ProdOrderLineNo")),
    // The published page carries only "Prod. Order Line No.", so fall back to
    // it rather than leaving every row numbered 0 - which would also collide as
    // a React key.
    lineNo: toNumber(pick(row, "Line_No", "LineNo", "Prod_Order_Line_No")),
    status: toStatus(pick(row, "Status")),
    itemNo: toText(pick(row, "Item_No", "ItemNo")),
    description: toText(pick(row, "Description")),
    unitOfMeasureCode: toText(pick(row, "Unit_of_Measure_Code", "UnitOfMeasureCode")),
    quantityPer: toNumber(pick(row, "Quantity_per", "QuantityPer")),
    quantity: toNumber(pick(row, "Quantity")),
    remainingQuantity: toNumber(pick(row, "Remaining_Quantity", "RemainingQuantity")),
    expectedQuantity: toNumber(pick(row, "Expected_Quantity", "ExpectedQuantity")),
    locationCode: toText(pick(row, "Location_Code", "LocationCode")),
    binCode: toText(pick(row, "Bin_Code", "BinCode")),
    variantCode: toText(pick(row, "Variant_Code", "VariantCode")),
    dueDate: toDate(pick(row, "Due_Date", "DueDate")),
    flushingMethod: toFlushingMethod(pick(row, "Flushing_Method", "FlushingMethod")),
    qtyPicked: toNumber(pick(row, "Qty_Picked_Base", "Qty_Picked", "QtyPicked")),
    completelyPicked: toBool(pick(row, "Completely_Picked", "CompletelyPicked")),
    emad: toDate(pick(row, "NETVAPS_EMAD_Date", "NETVAPSEMADDate")),
  };
}

export function toRoutingLine(row: RawRow): ProdOrderRoutingLine {
  return {
    prodOrderNo: toText(pick(row, "Prod_Order_No", "ProdOrderNo", "Prod. Order No.")),
    status: toStatus(pick(row, "Status")),
    routingNo: toText(pick(row, "Routing_No", "RoutingNo")),
    operationNo: toText(pick(row, "Operation_No", "OperationNo")),
    nextOperationNo: toText(pick(row, "Next_Operation_No", "NextOperationNo")),
    type: toText(pick(row, "Type")),
    no: toText(pick(row, "No", "No.", "No_")),
    // Not on the published page - only `No.` is. Kept because the PRINTING
    // exclusion checks both, and a differently published service may carry it.
    workCenterNo: toText(pick(row, "Work_Center_No", "WorkCenterNo")),
    workCenterGroupCode: toText(pick(row, "Work_Center_Group_Code", "WorkCenterGroupCode")),
    description: toText(pick(row, "Description")),
    setupTime: toNumber(pick(row, "Setup_Time", "SetupTime")),
    runTime: toNumber(pick(row, "Run_Time", "RunTime")),
    expectedCapacityNeed: toNumber(pick(row, "Expected_Capacity_Need", "ExpectedCapacityNeed")),
    routingStatus: toText(pick(row, "Routing_Status", "RoutingStatus")),
    // THE field the whole schedule keys on. The published page sends
    // "Starting Date-Time", not "Starting Date" - reading only the latter left
    // every order undated and the day-by-day board empty.
    startingDate: toDate(pick(row, "Starting_Date_Time", "Starting_Date", "StartingDate")),
    endingDate: toDate(pick(row, "Ending_Date_Time", "Ending_Date", "EndingDate")),
    locationCode: toText(pick(row, "Location_Code", "LocationCode")),
    scheduled: toBool(pick(row, "NETVAPS_Scheduled", "NETVAPSScheduled", "Scheduled_by_VAPS")),
    earliestStartDate: toDate(
      pick(row, "NETVAPS_Earliest_Start_Date", "NETVAPSEarliestStartDate", "Earliest_Start_Date"),
    ),
    emad: toDate(pick(row, "NETVAPS_EMAD", "NETVAPSEMAD", "Earliest_Material_Availability_Date")),
    notFullyPromised: toBool(pick(row, "NETVAPS_Not_Fully_Promised", "NETVAPSNotFullyPromised")),
  };
}

export function toOutputEvent(row: RawRow): OutputEvent {
  return {
    entryNo: toNumber(pick(row, "Entry_No", "EntryNo")),
    prodOrderNo: toText(pick(row, "Production_Order_No", "ProductionOrderNo")),
    sourceNo: toText(pick(row, "Source_No", "SourceNo")),
    buttonEvent: toText(pick(row, "Button_Event", "ButtonEvent")),
    eventType: toText(pick(row, "Event_Type", "EventType")),
    at: toText(pick(row, "DateTime", "Date_Time")),
    lineLeader: toText(pick(row, "Line_Leader", "LineLeader")),
    qtyOutput: toNumber(pick(row, "Qty_Output", "QtyOutput")),
    qtyScrapped: toNumber(pick(row, "Qty_Scrapped", "QtyScrapped")),
    booked: toBool(pick(row, "Booked")),
    lotNo: toText(pick(row, "OLC_Lot_No", "OLCLotNo")),
  };
}

export function toStockLot(row: RawRow): StockLot {
  return {
    itemNo: toText(pick(row, "Item_No", "ItemNo")),
    variantCode: toText(pick(row, "Variant_Code", "VariantCode")),
    lotNo: toText(pick(row, "Lot_No", "LotNo")),
    description: toText(pick(row, "Item_Description", "ItemDescription")),
    itemCategoryCode: toText(pick(row, "Item_Category_Code", "ItemCategoryCode")),
    locationCode: toText(pick(row, "Location_Code", "LocationCode")),
    binCode: toText(pick(row, "Bin_Code", "BinCode")),
    quantity: toNumber(pick(row, "Quantity_Base", "QuantityBase")),
    availableQuantity: toNumber(
      pick(row, "Avail_Qty_Base", "Available_Qty_Base", "AvailQtyBase"),
    ),
    unitOfMeasureCode: toText(pick(row, "Base_Unit_of_Measure_Code", "BaseUnitofMeasureCode")),
    // "Available" is not on the published page. Absent means nothing is
    // blocking the lot, so default to available rather than hiding all stock.
    available: pick(row, "Available") === undefined ? true : toBool(pick(row, "Available")),
    // The published page drops the PB365 prefix these fields carry on the table.
    expiryDate: toDate(pick(row, "Expiration_Date", "PB365_LM_Expiration_Date")),
    productionDate: toDate(pick(row, "Production_Date", "PB365_LM_Production_Date")),
    lotStatus: toText(pick(row, "Status", "PB365_LM_Status")),
  };
}

export function toPurchaseLine(row: RawRow): PurchaseLine {
  return {
    documentNo: toText(pick(row, "Document_No", "DocumentNo")),
    lineNo: toNumber(pick(row, "Line_No", "LineNo")),
    vendorNo: toText(pick(row, "Buy_from_Vendor_No", "BuyfromVendorNo")),
    itemNo: toText(pick(row, "No", "No.", "No_")),
    description: toText(pick(row, "Description")),
    locationCode: toText(pick(row, "Location_Code", "LocationCode")),
    quantity: toNumber(pick(row, "Quantity")),
    outstandingQuantity: toNumber(pick(row, "Outstanding_Quantity", "OutstandingQuantity")),
    quantityReceived: toNumber(pick(row, "Quantity_Received", "QuantityReceived")),
    expectedReceiptDate: toDate(pick(row, "Expected_Receipt_Date", "ExpectedReceiptDate")),
    promisedReceiptDate: toDate(pick(row, "Promised_Receipt_Date", "PromisedReceiptDate")),
    orderDate: toDate(pick(row, "Order_Date", "OrderDate")),
    unitOfMeasureCode: toText(pick(row, "Unit_of_Measure_Code", "UnitofMeasureCode")),
    completelyReceived: toBool(pick(row, "Completely_Received", "CompletelyReceived")),
  };
}

export function toSalesOrder(row: RawRow): SalesOrder {
  return {
    no: toText(pick(row, "No", "No.", "No_")),
    customerNo: toText(pick(row, "Sell_to_Customer_No", "SelltoCustomerNo")),
    customerName: toText(pick(row, "Sell_to_Customer_Name", "SelltoCustomerName")),
    billToName: toText(pick(row, "Bill_to_Name", "BilltoName")),
    externalDocumentNo: toText(pick(row, "External_Document_No", "ExternalDocumentNo")),
    yourReference: toText(pick(row, "Your_Reference", "YourReference")),
    locationCode: toText(pick(row, "Location_Code", "LocationCode")),
    salespersonCode: toText(pick(row, "Salesperson_Code", "SalespersonCode")),
    documentDate: toDate(pick(row, "Document_Date", "DocumentDate")),
    requestedDeliveryDate: toDate(pick(row, "Requested_Delivery_Date", "RequestedDeliveryDate")),
    shipmentDate: toDate(pick(row, "Shipment_Date", "ShipmentDate")),
    dueDate: toDate(pick(row, "Due_Date", "DueDate")),
    status: toNumber(pick(row, "Status")),
    completelyShipped: toBool(pick(row, "Completely_Shipped", "CompletelyShipped")),
    currencyCode: toText(pick(row, "Currency_Code", "CurrencyCode")),
    amount: toNumber(pick(row, "Amount")),
    amountIncludingVat: toNumber(pick(row, "Amount_Including_VAT", "AmountIncludingVAT")),
  };
}

export function toSalesLine(row: RawRow): SalesLine {
  return {
    documentNo: toText(pick(row, "Document_No", "DocumentNo")),
    lineNo: toNumber(pick(row, "Line_No", "LineNo")),
    itemNo: toText(pick(row, "No", "No.", "No_")),
    description: toText(pick(row, "Description")),
    locationCode: toText(pick(row, "Location_Code", "LocationCode")),
    variantCode: toText(pick(row, "Variant_Code", "VariantCode")),
    quantity: toNumber(pick(row, "Quantity")),
    outstandingQuantity: toNumber(pick(row, "Outstanding_Quantity", "OutstandingQuantity")),
    quantityShipped: toNumber(pick(row, "Quantity_Shipped", "QuantityShipped")),
    unitOfMeasureCode: toText(pick(row, "Unit_of_Measure_Code", "UnitofMeasureCode")),
    shipmentDate: toDate(pick(row, "Shipment_Date", "ShipmentDate")),
    unitPrice: toNumber(pick(row, "Unit_Price", "UnitPrice")),
    lineAmount: toNumber(pick(row, "Line_Amount", "LineAmount")),
  };
}

export function toItem(row: RawRow): Item {
  return {
    no: toText(pick(row, "No", "No.", "No_")),
    description: toText(pick(row, "Description")),
    searchDescription: toText(pick(row, "Search_Description", "SearchDescription")),
    baseUnitOfMeasure: toText(pick(row, "Base_Unit_of_Measure", "BaseUnitofMeasure")),
    itemCategoryCode: toText(pick(row, "Item_Category_Code", "ItemCategoryCode")),
    type: toText(pick(row, "Type")),
    inventory: toNumber(pick(row, "Inventory")),
    reorderPoint: toNumber(pick(row, "Reorder_Point", "ReorderPoint")),
    safetyStockQuantity: toNumber(pick(row, "Safety_Stock_Quantity", "SafetyStockQuantity")),
    // "Vendor No." is the spelling in the raw item export; the published page
    // renames it Vendor_No. Both arrive at different times from different
    // files, so the mapper takes either.
    vendorNo: toText(pick(row, "Vendor_No", "VendorNo", "Vendor No.")),
    replenishmentSystem: toText(
      pick(row, "Replenishment_System", "ReplenishmentSystem", "Replenishment System"),
    ),
    blocked: toBool(pick(row, "Blocked")),
    unitCost: toNumber(pick(row, "Unit_Cost", "UnitCost")),
  };
}

export function toVendor(row: RawRow): Vendor {
  return {
    no: toText(pick(row, "No", "No.", "No_")),
    name: toText(pick(row, "Name")),
  };
}
