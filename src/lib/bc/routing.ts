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
import { fetchService } from "./client";
import { toRoutingLine } from "./map";
import type { Fetched, ProdOrderRoutingLine } from "../types";

export async function getProdOrderRoutingLines(): Promise<Fetched<ProdOrderRoutingLine>> {
  const result = await fetchService("prodOrderRouting");
  return { ...result, rows: result.rows.map(toRoutingLine) };
}
