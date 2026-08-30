"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import DataTable, { type Column } from "@/components/data-table";
import type { BoardComponent, BoardOrder } from "@/lib/types";
import { RELEASED, statusName } from "@/lib/status";
import { isBehindPlan } from "@/lib/board";
import { floorLabel, floorTone, isOnTheLine } from "@/lib/floor";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { completionOf } from "@/lib/chain";
import { UNASSIGNED } from "@/lib/work-center";

/**
 * The dates here are the order's PLANNED dates - what VAPS scheduled it to run
 * between. The due date is kept, well to the right, because it is still the
 * commitment to the customer; but it does not drive the sort, the filters or
 * the red flags. See the note at the top of src/lib/board.ts.
 */
function buildColumns(asOf: string, lineCount: (order: BoardOrder) => number): Column<BoardOrder>[] {
  return [
    { key: "locationCode", label: "Location", cell: (r) => r.locationCode, nowrap: true },
    {
      key: "workCenter",
      label: "Work Center",
      cell: (r) => r.workCenter || UNASSIGNED,
      nowrap: true,
    },
    {
      key: "startingDate",
      label: "Planned start",
      cell: (r) => formatDate(r.startingDate),
      sortValue: (r) => r.startingDate ?? "",
      nowrap: true,
    },
    {
      key: "endingDate",
      label: "Planned end",
      cell: (r) => formatDate(r.endingDate),
      sortValue: (r) => r.endingDate ?? "",
      nowrap: true,
      // The plan says it should be off the line by now and BC has not finished
      // it. That is this board's definition of late.
      render: (r) =>
        isBehindPlan(r, asOf) ? (
          <span className="pill late">{formatDate(r.endingDate)}</span>
        ) : (
          formatDate(r.endingDate)
        ),
    },
    {
      key: "floor",
      label: "Floor",
      cell: (r) => (isOnTheLine(r.floor.status) ? floorLabel(r.floor.status) : ""),
      nowrap: true,
      render: (r) => <FloorPill order={r} />,
    },
    {
      key: "no",
      label: "No.",
      cell: (r) => r.no,
      nowrap: true,
      // Not a link any more: clicking the row opens the components underneath,
      // which is what the shop floor's own picking board does. The full list is
      // one click further in, from inside the panel.
      render: (r) => <span className="code">{r.no}</span>,
    },
    { key: "description", label: "Description", cell: (r) => r.description, wrap: true },
    { key: "brand", label: "Brand", cell: (r) => r.brand, nowrap: true },
    { key: "customerName", label: "Customer", cell: (r) => r.customerName, wrap: true },
    { key: "salesOrderNo", label: "Sales Order", cell: (r) => r.salesOrderNo, nowrap: true },
    { key: "status", label: "Status", cell: (r) => statusName(r.status), nowrap: true },
    {
      key: "quantity",
      label: "Quantity",
      cell: (r) => formatNumber(r.quantity),
      sortValue: (r) => r.quantity,
      numeric: true,
    },
    {
      key: "made",
      label: "Made",
      // From the shop-floor event log, not `Finished Quantity` - that field reads
      // 0 on every row in this tenant.
      cell: (r) => (r.made ? formatNumber(r.made) : ""),
      sortValue: (r) => r.made,
      numeric: true,
    },
    {
      key: "progress",
      label: "Progress",
      cell: (r) => (r.made ? `${Math.round(completionOf(r.made, r.quantity) * 100)}%` : ""),
      sortValue: (r) => completionOf(r.made, r.quantity),
      numeric: true,
      render: (r) => (r.made ? <ProgressCell made={r.made} planned={r.quantity} /> : null),
    },
    {
      key: "scrapped",
      label: "Scrap",
      cell: (r) => (r.scrapped ? formatNumber(r.scrapped) : ""),
      sortValue: (r) => r.scrapped,
      numeric: true,
    },
    {
      key: "lines",
      label: "Lines",
      // Manually flushed lines with something left on them - what a picker
      // would actually go and fetch. Zero means there is nothing to pick.
      cell: (r) => String(lineCount(r)),
      sortValue: (r) => lineCount(r),
      numeric: true,
    },
    {
      key: "scheduled",
      label: "VAPS",
      cell: (r) => (r.scheduled ? "Scheduled" : ""),
      nowrap: true,
    },
    {
      key: "dueDate",
      label: "Due Date",
      cell: (r) => formatDate(r.dueDate),
      sortValue: (r) => r.dueDate ?? "",
      nowrap: true,
    },
    { key: "assignedUserId", label: "Assigned", cell: (r) => r.assignedUserId, nowrap: true },
  ];
}

export default function OrdersTable({
  orders,
  componentsByOrder,
  stockKnown,
  asOf,
}: {
  orders: BoardOrder[];
  /** Component lines per production order, for the panel under each row. */
  componentsByOrder: Record<string, BoardComponent[]>;
  /**
   * Whether the stock feed is complete. When it is not, an item with no stock
   * row is unknown rather than absent, so the panel may not call anything short.
   */
  stockKnown: boolean;
  asOf: string;
}) {
  const [releasedOnly, setReleasedOnly] = useState(true);
  const [behindOnly, setBehindOnly] = useState(false);
  const [onLineOnly, setOnLineOnly] = useState(false);
  const [startedOnly, setStartedOnly] = useState(false);

  const toPick = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [orderNo, lines] of Object.entries(componentsByOrder)) {
      counts.set(orderNo, lines.filter((line) => line.remainingQuantity > 0).length);
    }
    return counts;
  }, [componentsByOrder]);

  const columns = useMemo(
    () => buildColumns(asOf, (order) => toPick.get(order.no) ?? 0),
    [asOf, toPick],
  );

  const rows = useMemo(
    () =>
      orders.filter((order) => {
        if (releasedOnly && order.status !== RELEASED) return false;
        if (behindOnly && !isBehindPlan(order, asOf)) return false;
        if (onLineOnly && !isOnTheLine(order.floor.status)) return false;
        if (startedOnly && order.made <= 0) return false;
        return true;
      }),
    [orders, releasedOnly, behindOnly, onLineOnly, startedOnly, asOf],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.no}
      exportName="production-orders"
      emptyMessage="No production orders match the current view."
      defaultSort={{ key: "startingDate", dir: "asc" }}
      expand={(row) => (
        <OrderDetail
          order={row}
          components={componentsByOrder[row.no] ?? []}
          stockKnown={stockKnown}
        />
      )}
      toolbar={
        <>
          <button
            type="button"
            className={releasedOnly ? "on" : undefined}
            onClick={() => setReleasedOnly((v) => !v)}
            title="Released is the status the shop floor works to. Turn this off to include planned and finished orders."
          >
            {releasedOnly ? "Released only" : "All statuses"}
          </button>
          <button
            type="button"
            className={behindOnly ? "on" : undefined}
            onClick={() => setBehindOnly((v) => !v)}
            title="Past the planned end date and not finished."
          >
            Behind plan
          </button>
          <button
            type="button"
            className={onLineOnly ? "on" : undefined}
            onClick={() => setOnLineOnly((v) => !v)}
            title="Running, paused or waiting on QA - the orders the floor has touched."
          >
            On the line
          </button>
          <button
            type="button"
            className={startedOnly ? "on" : undefined}
            onClick={() => setStartedOnly((v) => !v)}
            title="Orders the shop floor has booked output against - work in progress."
          >
            Started only
          </button>
        </>
      }
    />
  );
}

/** The Floor column and the panel heading share this. */
function FloorPill({ order }: { order: BoardOrder }) {
  const { status } = order.floor;
  if (!isOnTheLine(status)) return <span className="fl-none">—</span>;
  return <span className={`fl fl-${floorTone(status)}`}>{floorLabel(status)}</span>;
}

/**
 * What is under a row when you open it: the same component list the picking
 * control board shows, plus who last touched the order on the floor.
 */
function OrderDetail({
  order,
  components,
  stockKnown,
}: {
  order: BoardOrder;
  components: BoardComponent[];
  stockKnown: boolean;
}) {
  // Only lines with something left to consume. A fully consumed line is not
  // work, and listing it would pad the panel with rows nobody has to act on.
  const live = components.filter((component) => component.remainingQuantity > 0);

  return (
    <div className="det-in">
      <h3>
        Components for {order.no} — {live.length} line{live.length === 1 ? "" : "s"} to pick
      </h3>

      <p className="floormeta">
        <FloorPill order={order} />
        {order.floor.operator && <span>{order.floor.operator}</span>}
        {order.floor.at && <span>last event {formatDateTime(order.floor.at)}</span>}
        {order.made > 0 && <span>{formatNumber(order.made)} output to date</span>}
        {order.scrapped > 0 && <span>{formatNumber(order.scrapped)} scrapped</span>}
        {!order.floor.at && <span className="fl-none">Not started on the floor</span>}
      </p>

      {live.length === 0 ? (
        <p className="empty">Nothing left to pick on this order.</p>
      ) : (
        <div className="cmp-wrap">
          <table className="cmp">
            <thead>
              <tr>
                <th>Component</th>
                <th>Name</th>
                <th>UoM</th>
                <th className="num">Expected</th>
                <th className="num">Picked</th>
                <th className="num">Still to pick</th>
                {stockKnown && <th className="num">In stock</th>}
                {stockKnown && <th className="num">Short by</th>}
                <th className="num">Next delivery</th>
              </tr>
            </thead>
            <tbody>
              {live.map((component) => {
                const short = component.remainingQuantity - component.available;
                return (
                  <tr key={`${component.prodOrderLineNo}-${component.lineNo}-${component.itemNo}`}>
                    <td className="code">{component.itemNo}</td>
                    <td className="nm">
                      {stockKnown && <StockTag component={component} />}
                      {component.description}
                    </td>
                    <td>{component.unitOfMeasureCode}</td>
                    <td className="num">{formatNumber(component.expectedQuantity)}</td>
                    <td className="num">
                      {component.qtyPicked ? formatNumber(component.qtyPicked) : "—"}
                    </td>
                    <td className="num">{formatNumber(component.remainingQuantity)}</td>
                    {stockKnown && <td className="num">{formatNumber(component.available)}</td>}
                    {stockKnown && (
                      <td className="num">{short > 0 ? formatNumber(short) : "—"}</td>
                    )}
                    <td className="num">
                      {component.nextReceipt ? formatDate(component.nextReceipt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="det-more">
        <Link href={`/components?order=${encodeURIComponent(order.no)}`}>
          Open the full component list for {order.no} →
        </Link>
      </p>
    </div>
  );
}

/** Whether this line can be picked, in one word. */
function StockTag({ component }: { component: BoardComponent }) {
  if (component.completelyPicked) return <span className="tag t-ok">Picked</span>;
  if (component.available >= component.remainingQuantity) {
    return <span className="tag t-ok">In stock</span>;
  }
  if (component.available > 0) return <span className="tag t-part">Part covered</span>;
  return <span className="tag t-short">Short</span>;
}

/** A bar plus the number, so a glance and a close read both work. */
function ProgressCell({ made, planned }: { made: number; planned: number }) {
  const fraction = completionOf(made, planned);
  return (
    <span className="progress" title={`${formatNumber(made)} of ${formatNumber(planned)}`}>
      <span className="progress-bar">
        <span className="progress-fill" style={{ width: `${fraction * 100}%` }} />
      </span>
      {Math.round(fraction * 100)}%
    </span>
  );
}
