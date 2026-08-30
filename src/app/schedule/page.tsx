import ScheduleBoard from "@/components/schedule-board";
import NotConfigured from "@/components/not-configured";
import { SourceStamp, SnapshotNotice } from "@/components/source-label";
import { getProductionOrders } from "@/lib/bc/orders";
import { getProdOrderComponents } from "@/lib/bc/components";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { getOutputEvents } from "@/lib/bc/output";
import { getSalesOrders } from "@/lib/bc/sales";
import { getStock } from "@/lib/bc/inventory";
import { getOpenPurchaseLines } from "@/lib/bc/purchasing";
import {
  buildIncomingMap,
  buildPickStateMap,
  buildProgressMap,
  buildSalesOrderMap,
  buildStockMap,
  countPickStates,
  shortagesFor,
  type PickState,
} from "@/lib/chain";
import { buildFloorMap, NOT_ON_THE_LINE } from "@/lib/floor";
import Tiles from "@/components/tiles";
import type { BoardOrder } from "@/lib/types";
import { withWorkCenters } from "@/lib/work-center";
import { today } from "@/lib/board";
import type { ProdOrderComponent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const [orders, routing, components, output, sales, stock, purchases] = await Promise.all([
    getProductionOrders(),
    getProdOrderRoutingLines(),
    getProdOrderComponents(),
    getOutputEvents(),
    getSalesOrders(),
    getStock(),
    getOpenPurchaseLines(),
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

  // Grouped on the server so the browser is handed exactly what it renders.
  // A plain object, not a Map - Maps do not survive the server/client boundary.
  const componentsByOrder: Record<string, ProdOrderComponent[]> = {};
  for (const component of components.rows) {
    const key = component.prodOrderNo;
    if (!key) continue;
    (componentsByOrder[key] ??= []).push(component);
  }

  // Which orders cannot be made right now, and how many lines are short.
  // Computed on the server so the browser gets a number, not six feeds.
  const stockByItem = buildStockMap(stock.rows);
  const incomingByItem = buildIncomingMap(purchases.rows);
  // Only when the stock feed is complete. With a partial snapshot an item with
  // no row is unknown, not absent, and flagging it would put a red "short"
  // warning on nearly every card for no reason.
  const shortagesByOrder: Record<string, number> = {};
  const pickStateByOrder: Record<string, PickState> = {};
  if (!stock.partial) {
    for (const [orderNo, lines] of Object.entries(componentsByOrder)) {
      const short = shortagesFor(lines, stockByItem, incomingByItem).length;
      if (short > 0) shortagesByOrder[orderNo] = short;
    }
    const states = buildPickStateMap(componentsByOrder, stockByItem);
    for (const [orderNo, state] of states) pickStateByOrder[orderNo] = state;
  }
  const counts = countPickStates(new Map(Object.entries(pickStateByOrder)));

  return (
    <main className="page-schedule">
      <div className="page-head">
        <div>
          <h1>Schedule</h1>
          <p className="sub">
            By planned start date, one day at a time, split by work centre
          </p>
        </div>
        <SourceStamp result={orders} />
      </div>

      {orders.source === "not-configured" ? (
        <NotConfigured what="Production orders" missing={orders.missing} />
      ) : (
        <>
          <SnapshotNotice result={orders} />

          {!stock.partial && (
            <Tiles
              tiles={[
                {
                  label: "Can pick complete",
                  value: counts["can-pick"],
                  tone: "good",
                  note: "Every component line has the stock to cover it",
                },
                {
                  label: "Some components missing",
                  value: counts["some-missing"],
                  tone: "warn",
                  note: "Can start, will stall partway",
                },
                {
                  label: "No components available",
                  value: counts["none-available"],
                  tone: "crit",
                  note: "Cannot start at all",
                },
                {
                  label: "Nothing to pick",
                  value: counts["nothing-to-pick"],
                  note: "No manually flushed lines left to consume",
                },
              ]}
            />
          )}
          {routing.source === "not-configured" && (
            <div className="notice">
              <h2>Work centres unavailable</h2>
              <p>
                The routing-line feed is not connected. Without it no order has a work
                centre, so everything falls into a single column.
              </p>
            </div>
          )}
          <ScheduleBoard
            orders={rows}
            componentsByOrder={componentsByOrder}
            shortagesByOrder={shortagesByOrder}
            pickStateByOrder={pickStateByOrder}
            asOf={today()}
          />
        </>
      )}
    </main>
  );
}
