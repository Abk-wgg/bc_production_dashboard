// Open purchase order lines - BC table 39, published as
// `Purchase_Order_Line_Excel`. What is on its way in from suppliers.
//
// The table has a `Prod. Order No.` field, but it is EMPTY on every row
// sampled, so nothing here can be tied to a specific production order. Incoming
// stock is matched to demand by ITEM instead - see src/lib/chain.ts.

import "server-only";
import { fetchService } from "./client";
import { toPurchaseLine } from "./map";
import type { Fetched, PurchaseLine } from "../types";

/** Only lines with something still to come - a fully received line is history. */
export async function getOpenPurchaseLines(): Promise<Fetched<PurchaseLine>> {
  const result = await fetchService("purchaseLines");
  const rows = result.rows
    .map(toPurchaseLine)
    .filter((line) => line.outstandingQuantity > 0 && !line.completelyReceived);
  return { ...result, rows };
}
