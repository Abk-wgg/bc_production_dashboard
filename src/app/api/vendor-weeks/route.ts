// JSON feed of component demand per vendor per week — the same rows the
// By vendor page shows. Must stay in step with src/app/vendors/page.tsx.
//
// The lines are deliberately left out of the row. A vendor-week can hold three
// hundred of them, and a feed that inlined them would repeat the whole
// component table once per week. `/api/prod-order-components` is where the
// line-level data lives, whole; this answers "how much, from whom, when".

import { NextResponse } from "next/server";
import { getProdOrderComponents } from "@/lib/bc/components";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { getProductionOrders } from "@/lib/bc/orders";
import { getStock } from "@/lib/bc/inventory";
import { getOpenPurchaseLines } from "@/lib/bc/purchasing";
import { getItems, buildItemVendorMap } from "@/lib/bc/items";
import { getVendors, buildVendorNameMap } from "@/lib/bc/vendors";
import { buildScheduledStartMap, buildWorkCenterMap } from "@/lib/work-center";
import { buildIncomingMap, buildStockMap, toBoardComponent } from "@/lib/chain";
import { groupByVendorWeek, toVendorLines } from "@/lib/vendor-weeks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [components, routing, orders, stock, purchases, items, vendors] = await Promise.all([
    getProdOrderComponents(),
    getProdOrderRoutingLines(),
    getProductionOrders(),
    getStock(),
    getOpenPurchaseLines(),
    getItems(),
    getVendors(),
  ]);

  const workCenters = buildWorkCenterMap(routing.rows);
  const scheduledStarts = buildScheduledStartMap(routing.rows);
  const stockByItem = buildStockMap(stock.rows);
  const incomingByItem = buildIncomingMap(purchases.rows);
  const onBoard = new Set(orders.rows.map((o) => o.no));

  const board = components.rows
    .filter((component) => onBoard.has(component.prodOrderNo))
    .map((component) =>
      toBoardComponent(
        component,
        workCenters.get(component.prodOrderNo) ?? "",
        stockByItem,
        incomingByItem,
      ),
    );

  const lines = toVendorLines(
    board,
    buildItemVendorMap(items.rows),
    buildVendorNameMap(vendors.rows),
    scheduledStarts,
  );

  let rows = groupByVendorWeek(lines, !stock.partial).map(({ lines: _lines, ...row }) => row);

  const params = new URL(request.url).searchParams;
  // ?vendor=OLC-VEND-000005 narrows to one supplier; ?week=2026-08-31 to one
  // week, given as its Monday.
  const vendor = params.get("vendor")?.trim().toLowerCase();
  if (vendor) rows = rows.filter((r) => r.vendorNo.toLowerCase() === vendor);
  const week = params.get("week")?.trim();
  if (week) rows = rows.filter((r) => r.weekStart === week);

  return NextResponse.json({
    source: components.source,
    fetchedAt: components.fetchedAt,
    takenAt: components.takenAt,
    // How much of the board this feed could attribute. A consumer charting
    // spend per supplier needs to know 8% of it is under no supplier at all.
    lines: lines.length,
    linesWithVendor: lines.filter((l) => l.vendorNo).length,
    count: rows.length,
    vendorWeeks: rows,
  });
}
