// Vendor cards - BC table 23.
//
// Only here to turn OLC-VEND-000005 into "Advance Flavour Solutions". The link
// from a component to its supplier is `Vendor No.` on the item, not anything
// here; this is the name beside the code.
//
// That makes it the one feed the board can do without. A missing vendor list
// costs names, not rows - see toVendorLines, which falls back to the code.

import "server-only";
import { fetchService } from "./client";
import { toVendor } from "./map";
import type { Fetched, Vendor } from "../types";

export async function getVendors(): Promise<Fetched<Vendor>> {
  const result = await fetchService("vendors");
  return { ...result, rows: result.rows.map(toVendor).filter((v) => v.no !== "") };
}

/** Vendor No. to name, for looking a code up while rendering. */
export function buildVendorNameMap(vendors: Vendor[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const vendor of vendors) {
    if (vendor.name) map.set(vendor.no, vendor.name);
  }
  return map;
}
