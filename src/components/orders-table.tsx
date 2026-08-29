"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import DataTable, { type Column } from "@/components/data-table";
import type { OrderWithWorkCenter } from "@/lib/types";
import { RELEASED, statusName } from "@/lib/status";
import { isOverdue } from "@/lib/board";
import { formatDate, formatNumber } from "@/lib/format";
import { UNASSIGNED } from "@/lib/work-center";

const COLUMNS: Column<OrderWithWorkCenter>[] = [
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
  {
    key: "no",
    label: "No.",
    cell: (r) => r.no,
    nowrap: true,
    // Links through to this order's components, the same jump the Power Apps
    // version had.
    render: (r) => <Link href={`/components?order=${encodeURIComponent(r.no)}`}>{r.no}</Link>,
  },
  { key: "description", label: "Description", cell: (r) => r.description, wrap: true },
  { key: "brand", label: "Brand", cell: (r) => r.brand, nowrap: true },
  { key: "status", label: "Status", cell: (r) => statusName(r.status), nowrap: true },
  {
    key: "quantity",
    label: "Quantity",
    cell: (r) => formatNumber(r.quantity),
    sortValue: (r) => r.quantity,
    numeric: true,
  },
  { key: "salesOrderNo", label: "Sales Order", cell: (r) => r.salesOrderNo, nowrap: true },
  {
    key: "scheduled",
    label: "VAPS",
    cell: (r) => (r.scheduled ? "Scheduled" : ""),
    nowrap: true,
  },
  {
    key: "startingDate",
    label: "Starting",
    cell: (r) => formatDate(r.startingDate),
    sortValue: (r) => r.startingDate ?? "",
    nowrap: true,
  },
  {
    key: "endingDate",
    label: "Ending",
    cell: (r) => formatDate(r.endingDate),
    sortValue: (r) => r.endingDate ?? "",
    nowrap: true,
  },
  { key: "assignedUserId", label: "Assigned", cell: (r) => r.assignedUserId, nowrap: true },
];

export default function OrdersTable({
  orders,
  asOf,
}: {
  orders: OrderWithWorkCenter[];
  asOf: string;
}) {
  const [releasedOnly, setReleasedOnly] = useState(true);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const rows = useMemo(
    () =>
      orders.filter((order) => {
        if (releasedOnly && order.status !== RELEASED) return false;
        if (overdueOnly && !isOverdue(order, asOf)) return false;
        return true;
      }),
    [orders, releasedOnly, overdueOnly, asOf],
  );

  return (
    <DataTable
      rows={rows}
      columns={COLUMNS}
      rowKey={(row) => row.no}
      exportName="production-orders"
      emptyMessage="No production orders match the current view."
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
            className={overdueOnly ? "on" : undefined}
            onClick={() => setOverdueOnly((v) => !v)}
          >
            Overdue only
          </button>
        </>
      }
    />
  );
}
