import ComponentsTable from "@/components/components-table";
import NotConfigured from "@/components/not-configured";
import { getProdOrderComponents } from "@/lib/bc/components";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";
import { buildWorkCenterMap } from "@/lib/work-center";
import type { ComponentWithWorkCenter } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ComponentsPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const [{ order }, components, routing] = await Promise.all([
    searchParams,
    getProdOrderComponents(),
    getProdOrderRoutingLines(),
  ]);

  // Components carry no work centre of their own - it belongs to the parent
  // order's routing, so borrow it from there.
  const workCenters = buildWorkCenterMap(routing.rows);
  const rows: ComponentWithWorkCenter[] = components.rows.map((component) => ({
    ...component,
    workCenter: workCenters.get(component.prodOrderNo) ?? "",
  }));

  return (
    <main className="page-components">
      <div className="page-head">
        <div>
          <h1>Component list</h1>
          <p className="sub">Materials on each production order, with warehouse pick state</p>
        </div>
        <p className="stamp">
          {components.source === "business-central"
            ? `Business Central · ${new Date(components.fetchedAt).toLocaleTimeString("en-GB")}`
            : "Not connected"}
        </p>
      </div>

      {components.source === "not-configured" ? (
        <NotConfigured what="Prod. order components" missing={components.missing} />
      ) : (
        <ComponentsTable components={rows} initialOrder={order ?? ""} />
      )}
    </main>
  );
}
