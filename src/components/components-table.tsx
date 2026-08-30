"use client";

import { useMemo, useState } from "react";
import DataTable, { type Column } from "@/components/data-table";
import type { BoardComponent } from "@/lib/types";
import { RELEASED, statusName } from "@/lib/status";
import { formatDate, formatLineNo, formatNumber } from "@/lib/format";
import { UNASSIGNED } from "@/lib/work-center";

const COLUMNS: Column<BoardComponent>[] = [
  { key: "locationCode", label: "Location", cell: (r) => r.locationCode, nowrap: true },
  {
    key: "workCenter",
    label: "Work Center",
    cell: (r) => r.workCenter || UNASSIGNED,
    nowrap: true,
  },
  {
    key: "dueDate",
    // BC calls this the component's Due Date, but it is not a promise to
    // anyone: on all 1,000 rows checked it is exactly the parent order's
    // planned start - the day the material has to be at the line. Labelled for
    // what it is, so this page and the orders page talk about the same date.
    label: "Needed",
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
  {
    key: "available",
    label: "In Stock",
    // Available, not on-hand: on-hand includes quantity already committed
    // elsewhere, so it can say "plenty" about material you cannot touch.
    cell: (r) => formatNumber(r.available),
    sortValue: (r) => r.available,
    numeric: true,
  },
  {
    key: "shortBy",
    label: "Short By",
    cell: (r) => (isShort(r) ? formatNumber(r.remainingQuantity - r.available) : ""),
    sortValue: (r) => (isShort(r) ? r.remainingQuantity - r.available : 0),
    numeric: true,
    render: (r) =>
      isShort(r) ? (
        <span className="pill late">{formatNumber(r.remainingQuantity - r.available)}</span>
      ) : null,
  },
  {
    key: "nextReceipt",
    label: "Next Delivery",
    cell: (r) => formatDate(r.nextReceipt),
    sortValue: (r) => r.nextReceipt ?? "",
    nowrap: true,
  },
  {
    key: "earliestExpiry",
    label: "Expires",
    cell: (r) => formatDate(r.earliestExpiry),
    sortValue: (r) => r.earliestExpiry ?? "",
    nowrap: true,
  },
];

/** Not enough free stock to finish what is left of the line. */
function isShort(row: BoardComponent): boolean {
  return row.remainingQuantity > 0 && row.available < row.remainingQuantity;
}

export default function ComponentsTable({
  components,
  initialOrder,
  stockKnown,
}: {
  components: BoardComponent[];
  /** Pre-filter to one order, set when arriving from the orders page. */
  initialOrder: string;
  /**
   * Whether the stock feed is complete. When it is not, an item with no stock
   * row is unknown rather than absent, so nothing here may call it short.
   */
  stockKnown: boolean;
}) {
  const [releasedOnly, setReleasedOnly] = useState(true);
  const [order, setOrder] = useState(initialOrder);
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [shortOnly, setShortOnly] = useState(false);

  const columns = useMemo(
    () => (stockKnown ? COLUMNS : COLUMNS.filter((c) => c.key !== "shortBy")),
    [stockKnown],
  );

  const rows = useMemo(() => {
    const wanted = order.trim().toLowerCase();
    return components.filter((component) => {
      if (releasedOnly && component.status !== RELEASED) return false;
      if (outstandingOnly && component.remainingQuantity <= 0) return false;
      if (wanted && !component.prodOrderNo.toLowerCase().includes(wanted)) return false;
      if (shortOnly && stockKnown && !isShort(component)) return false;
      return true;
    });
  }, [components, releasedOnly, outstandingOnly, shortOnly, stockKnown, order]);

  return (
    <DataTable
      rows={rows}
      columns={columns}
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
          {stockKnown && (
            <button
              type="button"
              className={shortOnly ? "on" : undefined}
              onClick={() => setShortOnly((v) => !v)}
              title="Lines without enough free stock to finish what is left."
            >
              Short only
            </button>
          )}
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
