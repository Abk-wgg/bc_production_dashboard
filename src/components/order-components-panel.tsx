"use client";

import type { OrderComponents } from "@/lib/component-groups";
import { isShort, shortfallOf } from "@/lib/component-groups";
import { statusName } from "@/lib/status";
import { formatDate, formatLineNo, formatNumber } from "@/lib/format";

/**
 * What is under a component row when you open it: the order's lines, and
 * everything about them the summary row had to leave out.
 *
 * Same `det-in` panel the orders page opens, so a row that expands looks the
 * same wherever you are on the board.
 */
export default function OrderComponentsPanel({
  group,
  stockKnown,
}: {
  group: OrderComponents;
  stockKnown: boolean;
}) {
  return (
    <div className="det-in">
      <h3>
        Components for {group.prodOrderNo} — {group.lineCount} line
        {group.lineCount === 1 ? "" : "s"}
      </h3>

      <p className="floormeta">
        {group.fullyPicked ? (
          <span className="pill ok">Fully picked</span>
        ) : (
          <span className="pill part">
            {group.pickedLines} of {group.lineCount} picked
          </span>
        )}
        {stockKnown && group.shortLines > 0 && (
          <span className="pill late">
            {group.shortLines} short by {formatNumber(group.shortBy)}
          </span>
        )}
        {group.neededDate && <span>needed {formatDate(group.neededDate)}</span>}
        {group.nextReceipt && <span>next delivery {formatDate(group.nextReceipt)}</span>}
      </p>

      <div className="cmp-wrap">
        <table className="cmp">
          <thead>
            <tr>
              <th className="num">Line</th>
              <th>Item No.</th>
              <th>Description</th>
              <th>Status</th>
              <th>UoM</th>
              <th className="num">Expected</th>
              <th className="num">Remaining</th>
              <th className="num">Picked</th>
              <th>Fully Picked</th>
              {stockKnown && <th className="num">In Stock</th>}
              {stockKnown && <th className="num">Short By</th>}
              <th className="num">Next Delivery</th>
              <th className="num">Expires</th>
            </tr>
          </thead>
          <tbody>
            {group.lines.map((line) => (
              <tr key={`${line.prodOrderLineNo}-${line.lineNo}-${line.itemNo}`}>
                <td className="num">{formatLineNo(line.lineNo)}</td>
                <td className="code">{line.itemNo}</td>
                <td className="nm">{line.description}</td>
                <td>{statusName(line.status)}</td>
                <td>{line.unitOfMeasureCode}</td>
                <td className="num">{formatNumber(line.expectedQuantity)}</td>
                <td className="num">{formatNumber(line.remainingQuantity)}</td>
                <td className="num">{line.qtyPicked ? formatNumber(line.qtyPicked) : "—"}</td>
                <td>
                  {line.completelyPicked ? (
                    <span className="pill ok">Yes</span>
                  ) : (
                    <span className="pill">No</span>
                  )}
                </td>
                {stockKnown && <td className="num">{formatNumber(line.available)}</td>}
                {stockKnown && (
                  <td className="num">
                    {isShort(line) ? (
                      <span className="pill late">{formatNumber(shortfallOf(line))}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                <td className="num">{line.nextReceipt ? formatDate(line.nextReceipt) : "—"}</td>
                <td className="num">
                  {line.earliestExpiry ? formatDate(line.earliestExpiry) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
