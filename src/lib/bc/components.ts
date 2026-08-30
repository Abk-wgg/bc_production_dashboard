// Prod. Order Components - BC table 5407. The materials each order consumes.
//
// Read from the published web service `prod_order_comp_with_pick`, which - as
// the name says - also carries the warehouse pick fields, so the board can show
// whether an order's materials have actually been picked.

import "server-only";
import { fetchService } from "./client";
import { toComponent } from "./map";
import type { Fetched, ProdOrderComponent } from "../types";
import { isBoardStatus, isManuallyFlushed } from "../scope";

/**
 * Component lines that need a person to do something: manually flushed, on a
 * Released order. Forward and backward flushed lines are consumed by BC on its
 * own, so they are not work anybody tracks. See src/lib/scope.ts.
 */
export async function getProdOrderComponents(): Promise<Fetched<ProdOrderComponent>> {
  const result = await fetchService("prodOrderComponents");
  const rows = result.rows
    .map(toComponent)
    .filter(
      (component) =>
        isManuallyFlushed(component.flushingMethod) && isBoardStatus(component.status),
    );
  return { ...result, rows };
}
