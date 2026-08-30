// Production Order headers - BC table 5405.
//
// Not in standard API v2.0, hence the published web service. The field list
// mirrors the "ABK Production Order API" page from the earlier Power Apps
// prototype, plus the custom fields this tenant carries on 5405.

import "server-only";
import { fetchService } from "./client";
import { toProductionOrder } from "./map";
import type { Fetched, ProductionOrder } from "../types";
import { isBoardLocation, isBoardStatus } from "../scope";

/**
 * Every production order header the web service returns.
 *
 * Only Released orders at the PRODUCTION location - see src/lib/scope.ts. Both
 * rules are applied here rather than in the UI, so the tables, the schedule and
 * the JSON feeds cannot end up disagreeing about what is on the board.
 *
 * Note on `finishedQuantity`: it read 0 on all 200 rows sampled in this tenant,
 * so treat it as probably unpopulated rather than as evidence nothing is
 * finished. Completion is derived from `status`, never from this field.
 */
export async function getProductionOrders(): Promise<Fetched<ProductionOrder>> {
  const result = await fetchService("productionOrders");
  const rows = result.rows
    .map(toProductionOrder)
    .filter((order) => isBoardLocation(order.locationCode) && isBoardStatus(order.status));
  return { ...result, rows };
}
