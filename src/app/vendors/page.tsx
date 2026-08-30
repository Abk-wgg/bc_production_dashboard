import VendorWeeksBoard from "@/components/vendor-weeks-board";
import NotConfigured from "@/components/not-configured";
import { SourceStamp, SnapshotNotice } from "@/components/source-label";
import { getProdOrderComponents } from "@/lib/bc/components";
import { getProductionOrders } from "@/lib/bc/orders";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { getStock } from "@/lib/bc/inventory";
import { getOpenPurchaseLines } from "@/lib/bc/purchasing";
import { getItems, buildItemVendorMap, buildItemDescriptionMap } from "@/lib/bc/items";
import { getVendors, buildVendorNameMap } from "@/lib/bc/vendors";
import { buildScheduledStartMap, buildWorkCenterMap } from "@/lib/work-center";
import { buildIncomingMap, buildStockMap, toBoardComponent } from "@/lib/chain";
import { toVendorLines } from "@/lib/vendor-weeks";

export const metadata = { title: "Vendors" };

// Only visible in an installed app window - an ordinary browser tab strip is
// the browser's to paint, not ours. Matches the header, which it sits above.
export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#efe8f8" },
    { media: "(prefers-color-scheme: dark)", color: "#241a38" },
  ],
};

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
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
  // The week comes from the same map the schedule groups its days on, so the
  // two pages cannot disagree about which week a job runs in.
  const scheduledStarts = buildScheduledStartMap(routing.rows);

  // Same scope as the Component list: orders are already narrowed to the
  // PRODUCTION location, so they decide which components are on the board.
  const onBoard = new Set(orders.rows.map((o) => o.no));

  const stockByItem = buildStockMap(stock.rows);
  const incomingByItem = buildIncomingMap(purchases.rows);

  // The join this page exists for: component line -> item -> Vendor No.
  // `Vendor No.` on the item card is the only place BC records who supplies a
  // material. It resolves 92% of the board's component lines; the rest have no
  // vendor set and get their own row rather than disappearing.
  const vendorByItem = buildItemVendorMap(items.rows);
  const nameByVendor = buildVendorNameMap(vendors.rows);
  // Descriptions for the 8% of component lines BC left blank - see
  // buildItemDescriptionMap.
  const itemDescriptions = buildItemDescriptionMap(items.rows);

  const board = components.rows
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

  const lines = toVendorLines(board, vendorByItem, nameByVendor, scheduledStarts);

  const withVendor = lines.filter((l) => l.vendorNo).length;
  const asOf = new Date().toISOString().slice(0, 10);

  return (
    <main className="page-vendors">
      <div className="page-head">
        <div>
          <h1>Components by vendor</h1>
          <p className="sub">One week at a time: what each supplier&rsquo;s material is needed for</p>
        </div>
        <SourceStamp result={components} />
      </div>

      {components.source === "not-configured" ? (
        <NotConfigured what="Prod. order components" missing={components.missing} />
      ) : (
        <>
          <SnapshotNotice result={components} />

          {items.source === "not-configured" ? (
            <div className="notice">
              <h2>No item feed, so no vendors</h2>
              <p>
                The supplier of a component comes from <strong>Vendor No.</strong> on the
                item card. Without the item feed every line lands under
                <strong> No vendor set</strong>, which is the page working correctly on
                data it does not have — not a filtering bug.
              </p>
            </div>
          ) : (
            withVendor === 0 &&
            lines.length > 0 && (
              <div className="notice">
                <h2>The item feed carries no Vendor No.</h2>
                <p>
                  All {lines.length.toLocaleString("en-GB")} component lines resolved to{" "}
                  <strong>No vendor set</strong>. The item rows arrived, but without the{" "}
                  <code>Vendor_No</code> column — add it to the{" "}
                  <code>$select</code> on the <code>Items_card_excel</code> query, or let
                  the app read Business Central live.
                </p>
              </div>
            )
          )}

          {stock.partial && (
            <div className="notice">
              <h2>Stock figures are incomplete</h2>
              <p>
                The snapshot holds only part of the stock table, so an item with no row
                is not necessarily out of stock. <strong>Short By is hidden</strong>{" "}
                rather than reported wrongly — it returns as soon as the app reads
                Business Central live.
              </p>
            </div>
          )}

          <VendorWeeksBoard lines={lines} stockKnown={!stock.partial} asOf={asOf} />
        </>
      )}
    </main>
  );
}
