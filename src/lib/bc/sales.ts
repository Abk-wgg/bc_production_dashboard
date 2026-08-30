// The demand end of the chain - BC tables 36 and 37, published as
// `sale_order_list_custom_ab` and `Sales_Lines_Excel`.
//
// Every production order carries a `Sales Order No.`, populated on all 982
// board orders, so this is what turns "OLCRELPROD100" into "Time2Vape Ltd,
// wanted 30 September".

import "server-only";
import { fetchService } from "./client";
import { toSalesOrder, toSalesLine } from "./map";
import type { Fetched, SalesLine, SalesOrder } from "../types";

export async function getSalesOrders(): Promise<Fetched<SalesOrder>> {
  const result = await fetchService("salesOrders");
  return { ...result, rows: result.rows.map(toSalesOrder) };
}

export async function getSalesLines(): Promise<Fetched<SalesLine>> {
  const result = await fetchService("salesLines");
  return { ...result, rows: result.rows.map(toSalesLine) };
}
