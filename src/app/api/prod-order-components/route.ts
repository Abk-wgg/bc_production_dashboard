// JSON feed of prod. order components, with the same stock and incoming-supply
// joins the Component list page shows. Must stay in step with
// src/app/components/page.tsx — see the note in the production-orders route.

import { NextResponse } from "next/server";
import { getProdOrderComponents } from "@/lib/bc/components";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { getProductionOrders } from "@/lib/bc/orders";
import { getStock } from "@/lib/bc/inventory";
import { getOpenPurchaseLines } from "@/lib/bc/purchasing";
import { buildWorkCenterMap } from "@/lib/work-center";
import { buildIncomingMap, buildStockMap } from "@/lib/chain";
import type { FeedComponent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [components, routing, orders, stock, purchases] = await Promise.all([
    getProdOrderComponents(),
    getProdOrderRoutingLines(),
    getProductionOrders(),
    getStock(),
    getOpenPurchaseLines(),
  ]);

  const workCenters = buildWorkCenterMap(routing.rows);
  const stockByItem = buildStockMap(stock.rows);
  const incomingByItem = buildIncomingMap(purchases.rows);
  const onBoard = new Set(orders.rows.map((o) => o.no));

  let rows: FeedComponent[] = components.rows
    .filter((component) => onBoard.has(component.prodOrderNo))
    .map((component) => {
      const held = stockByItem.get(component.itemNo);
      const coming = incomingByItem.get(component.itemNo);
      return {
        ...component,
        workCenter: workCenters.get(component.prodOrderNo) ?? "",
        available: held?.available ?? 0,
        earliestExpiry: held?.earliestExpiry ?? null,
        onOrder: coming?.outstanding ?? 0,
        nextReceipt: coming?.nextReceipt ?? null,
      };
    });

  // ?order=OLCRELPROD100 narrows the feed to one order.
  const order = new URL(request.url).searchParams.get("order")?.trim().toLowerCase();
  if (order) rows = rows.filter((c) => c.prodOrderNo.toLowerCase() === order);

  return NextResponse.json({
    source: components.source,
    fetchedAt: components.fetchedAt,
    // When the data itself was taken from BC, if it is not live. A consumer
    // charting these rows needs to know they are an hour old, not seconds.
    takenAt: components.takenAt,
    count: rows.length,
    components: rows,
  });
}
