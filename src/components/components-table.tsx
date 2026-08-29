"use client";

import { useMemo, useState } from "react";
import DataTable, { type Column } from "@/components/data-table";
import type { ComponentWithWorkCenter } from "@/lib/types";
import { RELEASED, statusName } from "@/lib/status";
import { formatDate, formatLineNo, formatNumber } from "@/lib/format";
import { UNASSIGNED } from "@/lib/work-center";

const COLUMNS: Column<ComponentWithWorkCenter>[] = [
  { key: "locationCode", label: "Location", cell: (r) => r.locationCode, nowrap: true },
  {
    key: "workCenter",
    label: "Work Center",
    cell: (r) => r.workCenter || UNASSIGNED,
    nowrap: true,
  },
  {
    key: "dueDate",
    label: "Due Date",
    cell: (r) => formatDate(r.dueDate),
    sortValue: (r) => r.dueDate ?? "",
    nowrap: true,
  },
  { key: "prodOrderNo", label: "Prod. Order No.", cell: (r) => r.prodOrderNo, nowrap: true },
  {
    key: "lineNo",
    label: "Line",
    cell: (r) => formatLineNo(r.lineNo),
    sortValue: (r) => r.lineNo,
    numeric: true,
  },
  { key: "itemNo", label: "Item No.", cell: (r) => r.itemNo, nowrap: true },
  { key: "description", label: "Description", cell: (r) => r.description, wrap: true },
  { key: "status", label: "Status", cell: (r) => statusName(r.status), nowrap: true },
  {
    key: "remainingQuantity",
    label: "Remaining",
    cell: (r) => formatNumber(r.remainingQuantity),
    sortValue: (r) => r.remainingQuantity,
    numeric: true,
  },
  {
    key: "qtyPicked",
    label: "Picked",
    cell: (r) => formatNumber(r.qtyPicked),
    sortValue: (r) => r.qtyPicked,
    numeric: true,
  },
  {
    key: "completelyPicked",
    label: "Fully Picked",
    cell: (r) => (r.completelyPicked ? "Yes" : "No"),
    nowrap: true,
    render: (r) =>
      r.completelyPicked ? <span className="pill ok">Yes</span> : <span className="pill">No</span>,
  },
  { key: "unitOfMeasureCode", label: "UoM", cell: (r) => r.unitOfMeasureCode, nowrap: true },
];

export default function ComponentsTable({
  components,
  initialOrder,
}: {
  components: ComponentWithWorkCenter[];
  /** Pre-filter to one order, set when arriving from the orders page. */
  initialOrder: string;
}) {
  const [releasedOnly, setReleasedOnly] = useState(true);
  const [order, setOrder] = useState(initialOrder);
  const [outstandingOnly, setOutstandingOnly] = useState(false);

  const rows = useMemo(() => {
    const wanted = order.trim().toLowerCase();
    return components.filter((component) => {
      if (releasedOnly && component.status !== RELEASED) return false;
      if (outstandingOnly && component.remainingQuantity <= 0) return false;
      if (wanted && !component.prodOrderNo.toLowerCase().includes(wanted)) return false;
      return true;
    });
  }, [components, releasedOnly, outstandingOnly, order]);

  return (
    <DataTable
      rows={rows}
      columns={COLUMNS}
      rowKey={(row) => `${row.prodOrderNo}-${row.prodOrderLineNo}-${row.lineNo}`}
      exportName="prod-order-components"
      emptyMessage="No components match the current view."
      toolbar={
        <>
          <button
            type="button"
            className={releasedOnly ? "on" : undefined}
            onClick={() => setReleasedOnly((v) => !v)}
          >
            {releasedOnly ? "Released only" : "All statuses"}
          </button>
          <button
            type="button"
            className={outstandingOnly ? "on" : undefined}
            onClick={() => setOutstandingOnly((v) => !v)}
            title="Hide component lines with nothing left to consume."
          >
            Outstanding only
          </button>
          {order && (
            <button type="button" onClick={() => setOrder("")}>
              Clear order {order}
            </button>
          )}
        </>
      }
    />
  );
}
