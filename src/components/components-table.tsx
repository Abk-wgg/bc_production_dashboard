"use client";

import { useCallback, useMemo, useState } from "react";
import DataTable, { type Column, type ExportSheet } from "@/components/data-table";
import OrderComponentsPanel from "@/components/order-components-panel";
import type { BoardComponent } from "@/lib/types";
import { groupByOrder, isShort, type OrderComponents } from "@/lib/component-groups";
import { formatDate, formatNumber } from "@/lib/format";
import { UNASSIGNED } from "@/lib/work-center";

/**
 * One row per production order. Prod. Order No. leads and the table sorts on
 * it, because that is the thing being looked up - the old first column was
 * Location, which reads PRODUCTION on all 1,957 rows.
 *
 * Everything per-line - item, description, quantities, expiry - is in the panel
 * behind the row rather than here. Sixteen columns of it, repeated once per
 * component, was a spreadsheet of the underlying table rather than a view of
 * the work.
 *
 * Kept deliberately short. Every column is 703 more cells the browser has to
 * lay out and paint, and this table is read to answer one question - can this
 * order run - not to hold everything that might be asked later. Line count,
 * shortfall, next delivery and expiry are all still in the panel.
 */
const COLUMNS: Column<OrderComponents>[] = [
  {
    key: "prodOrderNo", width: "155px",
    label: "Prod. Order No.",
    cell: (r) => r.prodOrderNo,
    nowrap: true,
    // Same treatment as the No. column on the orders page: monospace, no
    // colour. The caret is what says the row opens.
    render: (r) => <span className="code">{r.prodOrderNo}</span>,
  },
  { key: "locationCode", width: "115px",  label: "Location", cell: (r) => r.locationCode, nowrap: true },
  {
    key: "workCenter", width: "130px",
    label: "Work Center",
    cell: (r) => r.workCenter || UNASSIGNED,
    nowrap: true,
  },
  {
    key: "neededDate", width: "105px", filter: "date",
    // BC calls this the component's Due Date, but it is not a promise to
    // anyone: it is the parent order's planned start - the day the material has
    // to be at the line. Labelled for what it is.
    label: "Needed",
    cell: (r) => formatDate(r.neededDate),
    sortValue: (r) => r.neededDate ?? "",
    nowrap: true,
  },
  {
    key: "remaining", width: "115px",
    label: "Remaining",
    cell: (r) => formatNumber(r.remaining),
    sortValue: (r) => r.remaining,
    numeric: true,
  },
  {
    key: "picked", width: "95px",
    label: "Picked",
    cell: (r) => formatNumber(r.picked),
    sortValue: (r) => r.picked,
    numeric: true,
  },
  {
    key: "fullyPicked", width: "130px",
    label: "Fully Picked",
    cell: (r) => (r.fullyPicked ? "Yes" : `${r.pickedLines} of ${r.lineCount}`),
    // Sorted on the proportion, so a part-picked order sits between an
    // untouched one and a finished one rather than alphabetically among them.
    sortValue: (r) => r.pickedLines / r.lineCount,
    nowrap: true,
    render: (r) =>
      r.fullyPicked ? (
        <span className="pill ok">Yes</span>
      ) : (
        <span className="pill part">
          {r.pickedLines} of {r.lineCount}
        </span>
      ),
  },
  {
    key: "shortLines", width: "90px",
    label: "Short",
    cell: (r) => (r.shortLines > 0 ? `${r.shortLines} line${r.shortLines === 1 ? "" : "s"}` : ""),
    sortValue: (r) => r.shortLines,
    nowrap: true,
    render: (r) => (r.shortLines > 0 ? <span className="pill late">{r.shortLines}</span> : null),
  },
];

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
  const [order, setOrder] = useState(initialOrder);
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [shortOnly, setShortOnly] = useState(false);

  const columns = useMemo(
    () =>
      stockKnown ? COLUMNS : COLUMNS.filter((c) => c.key !== "shortLines"),
    [stockKnown],
  );

  const rows = useMemo(() => {
    const wanted = order.trim().toLowerCase();
    // Filter the lines, then group. The other way round would count lines the
    // filter had already excluded, so the row and its panel would disagree.
    const lines = components.filter((component) => {
      if (outstandingOnly && component.remainingQuantity <= 0) return false;
      if (wanted && !component.prodOrderNo.toLowerCase().includes(wanted)) return false;
      if (shortOnly && stockKnown && !isShort(component)) return false;
      return true;
    });
    return groupByOrder(lines, stockKnown);
  }, [components, outstandingOnly, shortOnly, stockKnown, order]);

  /**
   * The component lines behind each order, as a second sheet.
   *
   * The table groups 1,957 lines into 703 orders, so without this the download
   * is 703 summaries and the line detail is only reachable through the JSON
   * feed. Built from the rows the export is writing, so a column filter
   * narrows this sheet with it.
   */
  const exportExtra = useCallback(
    (visible: OrderComponents[]): ExportSheet[] => [
      {
        name: "Lines",
        rows: visible.flatMap((group) =>
          group.lines.map((line) => ({
            "Prod. Order No.": line.prodOrderNo,
            "Line No.": line.lineNo,
            "Item No.": line.itemNo,
            Description: line.description,
            "Work Center": line.workCenter,
            Location: line.locationCode,
            UoM: line.unitOfMeasureCode,
            Needed: line.dueDate ?? "",
            Expected: line.expectedQuantity,
            Remaining: line.remainingQuantity,
            Picked: line.qtyPicked,
            "Fully Picked": line.completelyPicked ? "Yes" : "No",
            "In Stock": stockKnown ? line.available : "",
            "Next Delivery": line.nextReceipt ?? "",
            Expires: line.earliestExpiry ?? "",
          })),
        ),
      },
    ],
    [stockKnown],
  );

  // Stable, so DataTable's memoised rows survive a panel opening. An inline
  // arrow here is a new function every render, which invalidates all of them.
  const renderPanel = useCallback(
    (row: OrderComponents) => <OrderComponentsPanel group={row} stockKnown={stockKnown} />,
    [stockKnown],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.prodOrderNo}
      exportName="components-by-order"
      emptyMessage="No production orders match the current view."
      defaultSort={{ key: "prodOrderNo", dir: "asc" }}
      expand={renderPanel}
      exportExtra={exportExtra}
      toolbar={
        <>
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
