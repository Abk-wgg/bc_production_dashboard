import OrdersTable from "@/components/orders-table";
import NotConfigured from "@/components/not-configured";
import { getProductionOrders } from "@/lib/bc/orders";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { withWorkCenters } from "@/lib/work-center";
import { summarise, today } from "@/lib/board";
import { formatNumber } from "@/lib/format";

// Read at request time, never at build. The board is a live view; a page
// baked at build time would show whatever BC said the day it was deployed.
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  // Both feeds are independent, so ask for them at once rather than in series.
  const [orders, routing] = await Promise.all([
    getProductionOrders(),
    getProdOrderRoutingLines(),
  ]);

  const asOf = today();
  const rows = withWorkCenters(orders.rows, routing.rows);
  const summary = summarise(orders.rows, asOf);

  return (
    <main className="page-orders">
      <div className="page-head">
        <div>
          <h1>Production orders</h1>
          <p className="sub">
            {summary.outstanding} outstanding · {summary.overdue} overdue ·{" "}
            {summary.dueSoon} due within 7 days · {formatNumber(summary.outstandingUnits)} units
            to make
          </p>
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
                The routing-line feed is not connected, so the Work Center column is empty.
                Orders and quantities below are unaffected.
              </p>
            </div>
          )}
          <OrdersTable orders={rows} asOf={asOf} />
        </>
      )}
    </main>
  );
}
