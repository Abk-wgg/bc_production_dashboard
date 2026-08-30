import OrdersTable from "@/components/orders-table";
import NotConfigured from "@/components/not-configured";
import Tiles from "@/components/tiles";
import { SourceStamp, SnapshotNotice } from "@/components/source-label";
import { getProductionOrders } from "@/lib/bc/orders";
import { getProdOrderComponents } from "@/lib/bc/components";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { getOutputEvents } from "@/lib/bc/output";
import { getSalesOrders } from "@/lib/bc/sales";
import { getStock } from "@/lib/bc/inventory";
import { getOpenPurchaseLines } from "@/lib/bc/purchasing";
import { getItems, buildItemDescriptionMap } from "@/lib/bc/items";
import {
  buildIncomingMap,
  buildProgressMap,
  buildSalesOrderMap,
  buildStockMap,
  toBoardComponent,
} from "@/lib/chain";
import { buildFloorMap, countFloorStates, NOT_ON_THE_LINE } from "@/lib/floor";
import type { BoardComponent, BoardOrder } from "@/lib/types";
import { withWorkCenters, buildWorkCenterMap } from "@/lib/work-center";
import { summarise, today } from "@/lib/board";
import { formatNumber } from "@/lib/format";

// Read at request time, never at build. The board is a live view; a page
// baked at build time would show whatever BC said the day it was deployed.
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  // Every feed is independent, so ask for them at once rather than in series.
  const [orders, routing, components, output, sales, stock, purchases, items] =
    await Promise.all([
      getProductionOrders(),
      getProdOrderRoutingLines(),
      getProdOrderComponents(),
      getOutputEvents(),
      getSalesOrders(),
      getStock(),
      getOpenPurchaseLines(),
      getItems(),
    ]);

  const asOf = today();
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

  // The panel under each row needs the same joined component rows the
  // components page shows, so build them the same way and group by order.
  const workCenters = buildWorkCenterMap(routing.rows);
  const stockByItem = buildStockMap(stock.rows);
  const incomingByItem = buildIncomingMap(purchases.rows);
  // Descriptions for the 8% of component lines BC left blank - see
  // buildItemDescriptionMap.
  const itemDescriptions = buildItemDescriptionMap(items.rows);
  const onBoard = new Set(orders.rows.map((o) => o.no));

  // A plain object, not a Map - Maps do not survive the server/client boundary.
  const componentsByOrder: Record<string, BoardComponent[]> = {};
  for (const component of components.rows) {
    if (!onBoard.has(component.prodOrderNo)) continue;
    (componentsByOrder[component.prodOrderNo] ??= []).push(
      toBoardComponent(
        component,
        workCenters.get(component.prodOrderNo) ?? "",
        stockByItem,
        incomingByItem,
        itemDescriptions,
      ),
    );
  }

  const summary = summarise(orders.rows, asOf);
  const onTheFloor = countFloorStates(
    orders.rows.map((o) => o.no),
    floor,
  );
  const running = onTheFloor.running + onTheFloor.paused + onTheFloor["qa-booked"];

  return (
    <main className="page-orders">
      <div className="page-head">
        <div>
          <h1>Production orders</h1>
          <p className="sub">
            Released orders at the PRODUCTION location, on their planned dates, with what
            has actually been made. Click any order to open its components.
          </p>
        </div>
        <SourceStamp result={orders} />
      </div>

      {orders.source === "not-configured" ? (
        <NotConfigured what="Production orders" missing={orders.missing} />
      ) : (
        <>
          <SnapshotNotice result={orders} />

          <Tiles
            tiles={[
              {
                label: "Outstanding",
                value: summary.outstanding,
                suffix: `of ${summary.total}`,
                note: `${formatNumber(summary.outstandingUnits)} units still to make`,
              },
              {
                label: "Behind plan",
                value: summary.behindPlan,
                tone: summary.behindPlan > 0 ? "crit" : undefined,
                note: "Past the date the plan has them finishing",
              },
              {
                label: "Starting within 7 days",
                value: summary.startingSoon,
                tone: summary.startingSoon > 0 ? "warn" : undefined,
                note: "Planned to start, not yet late",
              },
              {
                label: "On the line",
                value: running,
                tone: running > 0 ? "good" : undefined,
                note: `${onTheFloor.running} running · ${onTheFloor.paused} paused · ${onTheFloor["qa-booked"]} QA booked`,
              },
            ]}
          />
          {routing.source === "not-configured" && (
            <div className="notice">
              <h2>Work centres unavailable</h2>
              <p>
                The routing-line feed is not connected, so the Work Center column is empty.
                Orders and quantities below are unaffected.
              </p>
            </div>
          )}
          <OrdersTable
            orders={rows}
            componentsByOrder={componentsByOrder}
            stockKnown={!stock.partial}
            asOf={asOf}
          />
        </>
      )}
    </main>
  );
}
