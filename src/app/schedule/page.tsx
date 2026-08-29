import ScheduleBoard from "@/components/schedule-board";
import NotConfigured from "@/components/not-configured";
import { getProductionOrders } from "@/lib/bc/orders";
import { getProdOrderComponents } from "@/lib/bc/components";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { withWorkCenters } from "@/lib/work-center";
import { today } from "@/lib/board";
import type { ProdOrderComponent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const [orders, routing, components] = await Promise.all([
    getProductionOrders(),
    getProdOrderRoutingLines(),
    getProdOrderComponents(),
  ]);

  const rows = withWorkCenters(orders.rows, routing.rows);

  // Grouped on the server so the browser is handed exactly what it renders.
  // A plain object, not a Map - Maps do not survive the server/client boundary.
  const componentsByOrder: Record<string, ProdOrderComponent[]> = {};
  for (const component of components.rows) {
    const key = component.prodOrderNo;
    if (!key) continue;
    (componentsByOrder[key] ??= []).push(component);
  }

  return (
    <main className="page-schedule">
      <div className="page-head">
        <div>
          <h1>Schedule</h1>
          <p className="sub">One day at a time, split by work centre</p>
        </div>
        <p className="stamp">
          {orders.source === "business-central"
            ? `Business Central · ${new Date(orders.fetchedAt).toLocaleTimeString("en-GB")}`
            : "Not connected"}
        </p>
      </div>

      {orders.source === "not-configured" ? (
        <NotConfigured what="Production orders" missing={orders.missing} />
      ) : (
        <>
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
            asOf={today()}
          />
        </>
      )}
    </main>
  );
}
