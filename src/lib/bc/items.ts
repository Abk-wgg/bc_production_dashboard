// Item master - BC table 27, published as `Item_Card_Excel`.
//
// Everything else in the chain refers to items by code. This turns
// "RMC/100737" into "10ML PET CLEAR BOTTLE", and carries the reorder point and
// safety stock that make a shortage mean something.

import "server-only";
import { fetchService } from "./client";
import { toItem } from "./map";
import type { Fetched, Item } from "../types";

export async function getItems(): Promise<Fetched<Item>> {
  const result = await fetchService("items");
  return { ...result, rows: result.rows.map(toItem) };
}

/**
 * Item No. to its description, for lines that arrived without one.
 *
 * BC copies the item's description onto a component line when the line is
 * created. On 147 of 1,957 lines - 8% - that copy is blank, and the item card
 * has a description for every single one of the 145 items involved. So the
 * blank is a stale copy, not a missing name.
 */
export function buildItemDescriptionMap(items: Item[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    if (item.description) map.set(item.no, item.description);
  }
  return map;
}

/**
 * Item No. to Vendor No., skipping items with no vendor set.
 *
 * An absent key and an empty value would mean the same thing to every caller,
 * so only real links go in. 7,396 of 10,354 items carry one.
 */
export function buildItemVendorMap(items: Item[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    if (item.vendorNo) map.set(item.no, item.vendorNo);
  }
  return map;
}
