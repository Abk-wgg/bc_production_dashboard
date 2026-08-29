// JSON feed of production orders, work centre included - the same data the
// board shows. Exists so Excel and Power BI can pull from one place instead of
// each growing its own BC connection.

import { NextResponse } from "next/server";
import { getProductionOrders } from "@/lib/bc/orders";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { withWorkCenters } from "@/lib/work-center";

export const dynamic = "force-dynamic";

export async function GET() {
  const [orders, routing] = await Promise.all([
    getProductionOrders(),
    getProdOrderRoutingLines(),
  ]);

  return NextResponse.json({
    source: orders.source,
    fetchedAt: orders.fetchedAt,
    count: orders.rows.length,
    orders: withWorkCenters(orders.rows, routing.rows),
  });
}
