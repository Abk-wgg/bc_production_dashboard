"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { VendorWeek } from "@/lib/vendor-weeks";
import { groupLinesByItem, type ItemDemand } from "@/lib/item-groups";
import { formatDate, formatNumber } from "@/lib/format";
import { sundayOf, weekLabel } from "@/lib/weeks";

/**
 * What is under a vendor-week row when you open it: the items, and under each
 * item, the orders it is for.
 *
 * Two levels because the two questions are asked in that order. A buyer is
 * about to raise a purchase order, which has one line per item - so the item
 * and its total quantity is the row. "Which orders is that for" is the
 * follow-up, and it sits behind the item rather than beside it, because
 * repeating the item on every order line is the flat shape this replaced.
 */
export default function VendorWeekPanel({
  group,
  stockKnown,
}: {
  group: VendorWeek;
  stockKnown: boolean;
}) {
  const items = useMemo(
    () => groupLinesByItem(group.lines, stockKnown),
    [group.lines, stockKnown],
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  function toggle(itemNo: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(itemNo)) next.add(itemNo);
      return next;
    });
  }

  const shortItems = items.filter((i) => i.shortBy > 0).length;
  // Columns: caret, item, description, UoM, orders, needed, qty [, stock, short]
  const span = stockKnown ? 9 : 7;

  return (
    <div className="det-in">
      <h3>
        {group.vendorNo ? group.vendorName : "Items with no vendor set"}
        {group.weekStart && (
          <>
            {" — "}
            {weekLabel(group.weekStart)}, {formatDate(group.weekStart)} to{" "}
            {formatDate(sundayOf(group.weekStart))}
          </>
        )}
      </h3>

      <p className="floormeta">
        {group.vendorNo && <span className="code">{group.vendorNo}</span>}
        <span>
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
        <span>
          {group.orderCount} order{group.orderCount === 1 ? "" : "s"}
        </span>
        <span>
          {group.lineCount} line{group.lineCount === 1 ? "" : "s"}
        </span>
        {stockKnown && shortItems > 0 && (
          <span className="pill late">
            {shortItems} item{shortItems === 1 ? "" : "s"} short
          </span>
        )}
      </p>

      <div className="cmp-wrap">
        <table className="cmp">
          <thead>
            <tr>
              <th className="exp" aria-label="Expand" />
              <th>Item No.</th>
              <th>Description</th>
              <th>UoM</th>
              <th className="num">Orders</th>
              <th className="num">Needed</th>
              <th className="num">Quantity</th>
              {stockKnown && <th className="num">In Stock</th>}
              {stockKnown && <th className="num">Short By</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ItemRows
                key={item.itemNo}
                item={item}
                isOpen={open.has(item.itemNo)}
                onToggle={toggle}
                stockKnown={stockKnown}
                span={span}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemRows({
  item,
  isOpen,
  onToggle,
  stockKnown,
  span,
}: {
  item: ItemDemand;
  isOpen: boolean;
  onToggle: (itemNo: string) => void;
  stockKnown: boolean;
  span: number;
}) {
  const lines = [...item.lines].sort(
    (a, b) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
      a.prodOrderNo.localeCompare(b.prodOrderNo, undefined, { numeric: true }),
  );

  return (
    <>
      <tr
        className={isOpen ? "itm open" : "itm"}
        tabIndex={0}
        role="button"
        aria-expanded={isOpen}
        onClick={(e) => {
          // A link inside the row does its own job.
          if ((e.target as HTMLElement).closest("a, button")) return;
          onToggle(item.itemNo);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onToggle(item.itemNo);
        }}
      >
        <td className="exp">
          <span className="caret">{isOpen ? "▼" : "▶"}</span>
        </td>
        <td className="code">{item.itemNo}</td>
        <td className="nm">{item.description}</td>
        <td>{item.unitOfMeasureCode}</td>
        <td className="num">{item.orderCount}</td>
        <td className="num">{item.earliestNeeded ? formatDate(item.earliestNeeded) : "—"}</td>
        <td className="num strong">{formatNumber(item.remaining)}</td>
        {stockKnown && <td className="num">{formatNumber(item.available)}</td>}
        {stockKnown && (
          <td className="num">
            {item.shortBy > 0 ? (
              <span className="pill late">{formatNumber(item.shortBy)}</span>
            ) : (
              "—"
            )}
          </td>
        )}
      </tr>

      {isOpen && (
        <tr className="itm-det">
          <td colSpan={span}>
            <table className="cmp cmp-sub">
              <thead>
                <tr>
                  <th>Prod. Order No.</th>
                  <th>Work Center</th>
                  <th className="num">Needed</th>
                  <th className="num">Quantity</th>
                  <th className="num">Picked</th>
                  <th>Fully Picked</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={`${line.prodOrderNo}-${line.prodOrderLineNo}-${line.lineNo}`}>
                    <td className="code">
                      <Link href={`/components?order=${encodeURIComponent(line.prodOrderNo)}`}>
                        {line.prodOrderNo}
                      </Link>
                    </td>
                    <td>{line.workCenter || "—"}</td>
                    <td className="num">{line.dueDate ? formatDate(line.dueDate) : "—"}</td>
                    <td className="num">{formatNumber(line.remainingQuantity)}</td>
                    <td className="num">{line.qtyPicked ? formatNumber(line.qtyPicked) : "—"}</td>
                    <td>
                      {line.completelyPicked ? (
                        <span className="pill ok">Yes</span>
                      ) : (
                        <span className="pill">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
