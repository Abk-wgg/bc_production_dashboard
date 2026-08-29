// Prod. Order Routing Lines - BC table 5409.
//
// NOTE ON THE TABLE ID: this is 5409. The earlier Power Apps prototype's AL
// page commented it as 5410, which is wrong - 5410 is "Prod. Order Capacity
// Need". The page still compiled because AL resolves SourceTable by NAME, so
// the mistake was invisible there. It is not invisible here, so: 5409.
//
// This is where an order's work centre comes from. Table 5405 does not carry
// one; each routing line ties one operation to a work or machine centre.
//
// Read from the published web service `Prod_Order_Routing_Excel`.

import "server-only";
import { fetchService, type RawRow } from "./client";
import type { Fetched, ProdOrderRoutingLine } from "../types";
import { pick, toBool, toDate, toNumber, toText } from "./fields";
import { toStatus } from "../status";

function toRoutingLine(row: RawRow): ProdOrderRoutingLine {
  return {
    prodOrderNo: toText(pick(row, "Prod_Order_No", "ProdOrderNo", "Prod. Order No.")),
    status: toStatus(pick(row, "Status")),
    routingNo: toText(pick(row, "Routing_No", "RoutingNo")),
    operationNo: toText(pick(row, "Operation_No", "OperationNo")),
    nextOperationNo: toText(pick(row, "Next_Operation_No", "NextOperationNo")),
    type: toText(pick(row, "Type")),
    no: toText(pick(row, "No", "No.", "No_")),
    workCenterNo: toText(pick(row, "Work_Center_No", "WorkCenterNo")),
    workCenterGroupCode: toText(pick(row, "Work_Center_Group_Code", "WorkCenterGroupCode")),
    description: toText(pick(row, "Description")),
    setupTime: toNumber(pick(row, "Setup_Time", "SetupTime")),
    runTime: toNumber(pick(row, "Run_Time", "RunTime")),
    expectedCapacityNeed: toNumber(pick(row, "Expected_Capacity_Need", "ExpectedCapacityNeed")),
    routingStatus: toText(pick(row, "Routing_Status", "RoutingStatus")),
    startingDate: toDate(pick(row, "Starting_Date", "StartingDate")),
    endingDate: toDate(pick(row, "Ending_Date", "EndingDate")),
    locationCode: toText(pick(row, "Location_Code", "LocationCode")),
    scheduled: toBool(pick(row, "NETVAPS_Scheduled", "NETVAPSScheduled", "Scheduled_by_VAPS")),
    earliestStartDate: toDate(
      pick(row, "NETVAPS_Earliest_Start_Date", "NETVAPSEarliestStartDate", "Earliest_Start_Date"),
    ),
    emad: toDate(pick(row, "NETVAPS_EMAD", "NETVAPSEMAD", "Earliest_Material_Availability_Date")),
    notFullyPromised: toBool(pick(row, "NETVAPS_Not_Fully_Promised", "NETVAPSNotFullyPromised")),
  };
}

export async function getProdOrderRoutingLines(): Promise<Fetched<ProdOrderRoutingLine>> {
  const result = await fetchService("prodOrderRouting");
  return { ...result, rows: result.rows.map(toRoutingLine) };
}
