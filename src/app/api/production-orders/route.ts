// JSON feed of production orders — the same rows, with the same joins, that
// the board itself renders. Exists so Excel and Power BI can pull from one
// place instead of each growing its own BC connection.
//
// This route must stay in step with src/app/page.tsx. A feed that quietly
// omits a column the page shows is worse than no feed: two people compare
// numbers, disagree, and neither is wrong.

import { NextResponse } from "next/server";
import { getProductionOrders } from "@/lib/bc/orders";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { getOutputEvents } from "@/lib/bc/output";
import { getSalesOrders } from "@/lib/bc/sales";
import { withWorkCenters } from "@/lib/work-center";
import { buildProgressMap, buildSalesOrderMap } from "@/lib/chain";
import { buildFloorMap, NOT_ON_THE_LINE } from "@/lib/floor";
import type { BoardOrder } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const [orders, routing, output, sales] = await Promise.all([
    getProductionOrders(),
    getProdOrderRoutingLines(),
    getOutputEvents(),
    getSalesOrders(),
  ]);

  const progress = buildProgressMap(output.rows);
  const floor = buildFloorMap(output.rows);
  const salesOrders = buildSalesOrderMap(sales.rows);

  const rows: BoardOrder[] = withWorkCenters(orders.rows, routing.rows).map((order) => {
    const made = progress.get(order.no);
    const salesOrder = salesOrders.get(order.salesOrderNo);
    return {
      ...order,
      made: made?.made ?? 0,
      scrapped: made?.scrapped ?? 0,
      lastBookedAt: made?.lastBookedAt ?? null,
      floor: floor.get(order.no) ?? NOT_ON_THE_LINE,
      customerName: salesOrder?.customerName ?? "",
      salesShipmentDate: salesOrder?.shipmentDate ?? null,
    };
  });

  return NextResponse.json({
    source: orders.source,
    fetchedAt: orders.fetchedAt,
    count: rows.length,
    orders: rows,
  });
}
