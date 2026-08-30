// Lot-level stock - BC table 5517495 "PB365 Inventory Summary", published as
// `Inventory_Summary_Excel`.
//
// One row per item / variant / lot / bin, with the quantity actually available
// rather than the nominal on-hand. Lot-tracked items (the liquids) also carry
// an expiry date; everything else leaves it blank.

import "server-only";
import { fetchService } from "./client";
import { toStockLot } from "./map";
import type { Fetched, StockLot } from "../types";

export async function getStock(): Promise<Fetched<StockLot>> {
  const result = await fetchService("inventory");
  return { ...result, rows: result.rows.map(toStockLot) };
}
