// Production Order headers - BC table 5405.
//
// Not in standard API v2.0, hence the published web service. The field list
// mirrors the "ABK Production Order API" page from the earlier Power Apps
// prototype, plus the custom fields this tenant carries on 5405.

import "server-only";
import { fetchService, type RawRow } from "./client";
import type { Fetched, ProductionOrder } from "../types";
import { pick, toDate, toNumber, toText, toBool } from "./fields";
import { toStatus } from "../status";

function toProductionOrder(row: RawRow): ProductionOrder {
  return {
    no: toText(pick(row, "No", "No.", "No_")),
    status: toStatus(pick(row, "Status")),
    description: toText(pick(row, "Description")),
    itemNo: toText(pick(row, "Source_No", "Source No.", "SourceNo")),
    routingNo: toText(pick(row, "Routing_No", "RoutingNo")),
    quantity: toNumber(pick(row, "Quantity")),
    finishedQuantity: toNumber(pick(row, "Finished_Quantity", "FinishedQuantity")),
    dueDate: toDate(pick(row, "Due_Date", "DueDate")),
    startingDate: toDate(pick(row, "Starting_Date", "StartingDate")),
    endingDate: toDate(pick(row, "Ending_Date", "EndingDate")),
    finishedDate: toDate(pick(row, "Finished_Date", "FinishedDate")),
    locationCode: toText(pick(row, "Location_Code", "LocationCode")),
    assignedUserId: toText(pick(row, "Assigned_User_ID", "AssignedUserID", "AssignedUserId")),
    brand: toText(pick(row, "Brand")),
    salesOrderNo: toText(pick(row, "Sales_Order_No", "SalesOrderNo")),
    scheduled: toBool(pick(row, "NETVAPS_Scheduled", "NETVAPSScheduled")),
    completelyPicked: toBool(pick(row, "Completely_Picked", "CompletelyPicked")),
  };
}

/**
 * Every production order header the web service returns.
 *
 * Note on `finishedQuantity`: it read 0 on all 200 rows sampled in this tenant,
 * so treat it as probably unpopulated rather than as evidence nothing is
 * finished. Completion is derived from `status`, never from this field.
 */
export async function getProductionOrders(): Promise<Fetched<ProductionOrder>> {
  const result = await fetchService("productionOrders");
  return { ...result, rows: result.rows.map(toProductionOrder) };
}
