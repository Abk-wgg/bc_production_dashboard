import ComponentsTable from "@/components/components-table";
import NotConfigured from "@/components/not-configured";
import { SourceStamp, SnapshotNotice } from "@/components/source-label";
import { getProdOrderComponents } from "@/lib/bc/components";
import { getProductionOrders } from "@/lib/bc/orders";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { buildWorkCenterMap } from "@/lib/work-center";
import { getStock } from "@/lib/bc/inventory";
import { getOpenPurchaseLines } from "@/lib/bc/purchasing";
import { getItems, buildItemDescriptionMap } from "@/lib/bc/items";
import { buildIncomingMap, buildStockMap, toBoardComponent } from "@/lib/chain";
import type { BoardComponent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ComponentsPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const [{ order }, components, routing, orders, stock, purchases, items] = await Promise.all([
    searchParams,
    getProdOrderComponents(),
    getProdOrderRoutingLines(),
    getProductionOrders(),
    getStock(),
    getOpenPurchaseLines(),
    getItems(),
  ]);

  // Components carry no work centre of their own - it belongs to the parent
  // order's routing, so borrow it from there.
  const workCenters = buildWorkCenterMap(routing.rows);

  // Orders are already narrowed to the PRODUCTION location, so use them to
  // decide which components belong on the board. Filtering by the component's
  // own location code would not be the same thing - a component can be held at
  // a different location from the order that consumes it.
  const onBoard = new Set(orders.rows.map((o) => o.no));

  // Stock and incoming supply are matched by ITEM. Purchase lines carry a
  // `Prod. Order No.` field, but it is empty on every row, so there is no way
  // to say which order a delivery is earmarked for.
  const stockByItem = buildStockMap(stock.rows);
  const incomingByItem = buildIncomingMap(purchases.rows);
  // Descriptions for the 8% of component lines BC left blank - see
  // buildItemDescriptionMap.
  const itemDescriptions = buildItemDescriptionMap(items.rows);

  // toBoardComponent, not a spread: what is listed there is what gets
  // serialised into the HTML, once for each of these rows.
  const rows: BoardComponent[] = components.rows
    .filter((component) => onBoard.has(component.prodOrderNo))
    .map((component) =>
      toBoardComponent(
        component,
        workCenters.get(component.prodOrderNo) ?? "",
        stockByItem,
        incomingByItem,
        itemDescriptions,
      ),
    );

  return (
    <main className="page-components">
      <div className="page-head">
        <div>
          <h1>Component list</h1>
          <p className="sub">Materials on each production order, with warehouse pick state</p>
        </div>
        <SourceStamp result={components} />
      </div>

      {components.source === "not-configured" ? (
        <NotConfigured what="Prod. order components" missing={components.missing} />
      ) : (
        <>
          <SnapshotNotice result={components} />
          {stock.partial && (
            <div className="notice">
              <h2>Stock figures are incomplete</h2>
              <p>
                The snapshot holds only part of the stock table, so an item with no row
                is not necessarily out of stock. <strong>Short By is hidden</strong>
                rather than reported wrongly — it returns as soon as the app reads
                Business Central live.
              </p>
            </div>
          )}
          <ComponentsTable
            components={rows}
            initialOrder={order ?? ""}
            stockKnown={!stock.partial}
          />
        </>
      )}
    </main>
  );
}
