// Prod. Order Components - BC table 5407. The materials each order consumes.
//
// Read from the published web service `prod_order_comp_with_pick`, which - as
// the name says - also carries the warehouse pick fields, so the board can show
// whether an order's materials have actually been picked.

import "server-only";
import { fetchService, type RawRow } from "./client";
import type { Fetched, ProdOrderComponent } from "../types";
import { pick, toBool, toDate, toNumber, toText } from "./fields";
import { toStatus } from "../status";

function toComponent(row: RawRow): ProdOrderComponent {
  return {
    prodOrderNo: toText(pick(row, "Prod_Order_No", "ProdOrderNo", "Prod. Order No.")),
    prodOrderLineNo: toNumber(pick(row, "Prod_Order_Line_No", "ProdOrderLineNo")),
    lineNo: toNumber(pick(row, "Line_No", "LineNo")),
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
    qtyPicked: toNumber(pick(row, "Qty_Picked", "QtyPicked", "Qty._Picked")),
    completelyPicked: toBool(pick(row, "Completely_Picked", "CompletelyPicked")),
    emad: toDate(pick(row, "NETVAPS_EMAD_Date", "NETVAPSEMADDate")),
  };
}

export async function getProdOrderComponents(): Promise<Fetched<ProdOrderComponent>> {
  const result = await fetchService("prodOrderComponents");
  return { ...result, rows: result.rows.map(toComponent) };
}
