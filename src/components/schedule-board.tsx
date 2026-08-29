"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { OrderWithWorkCenter, ProdOrderComponent } from "@/lib/types";
import { RELEASED } from "@/lib/status";
import { formatDayHeading, formatNumber } from "@/lib/format";
import { groupByDay, locationsIn, toWorkCenterColumns, NO_DATE } from "@/lib/schedule";
import { UNASSIGNED, orderHasCategory } from "@/lib/work-center";

// One colour per location so a card's origin is readable at a glance from
// across the room, which is how this board actually gets used.
const LOCATION_COLOURS = ["#c9ada7", "#7fa6c9", "#8fcf9b", "#e0c074", "#c19ad8", "#6fc5c5"];

type Category = "production" | "trade" | null;

export default function ScheduleBoard({
  orders,
  componentsByOrder,
  asOf,
}: {
  orders: OrderWithWorkCenter[];
  /** Components keyed by production order number. */
  componentsByOrder: Record<string, ProdOrderComponent[]>;
  asOf: string;
}) {
  const [category, setCategory] = useState<Category>(null);
  const [releasedOnly, setReleasedOnly] = useState(true);
  const [from, setFrom] = useState(asOf);
  const [dayIndex, setDayIndex] = useState(0);

  const colourForLocation = useMemo(() => {
    const locations = locationsIn(orders);
    const map = new Map<string, string>();
    locations.forEach((code, i) => map.set(code, LOCATION_COLOURS[i % LOCATION_COLOURS.length]));
    return map;
  }, [orders]);

  const visible = useMemo(
    () =>
      orders.filter((order) => {
        if (releasedOnly && order.status !== RELEASED) return false;
        if (category && !orderHasCategory(order.workCenter, category)) return false;
        // An order with no due date cannot sit on a day, so a "from" filter
        // necessarily excludes it.
        if (from && (!order.dueDate || order.dueDate < from)) return false;
        return true;
      }),
    [orders, releasedOnly, category, from],
  );

  const days = useMemo(() => groupByDay(visible), [visible]);

  // Filters can shrink the list under the current index, so clamp rather than
  // reset - staying near the day you were looking at is less disorienting.
  const index = days.length === 0 ? 0 : Math.min(Math.max(dayIndex, 0), days.length - 1);
  const day = days[index];

  const columns = useMemo(
    () => (day ? toWorkCenterColumns(day.orders, category) : []),
    [day, category],
  );

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={category === null ? "on" : undefined}
          onClick={() => setCategory(null)}
        >
          All centres
        </button>
        <button
          type="button"
          className={category === "production" ? "on" : undefined}
          onClick={() => setCategory("production")}
          title="Work centres whose code starts PROD - our own production."
        >
          Production
        </button>
        <button
          type="button"
          className={category === "trade" ? "on" : undefined}
          onClick={() => setCategory("trade")}
          title="Everything else - bought-in and trade centres."
        >
          Trade
        </button>
        <button
          type="button"
          className={releasedOnly ? "on" : undefined}
          onClick={() => setReleasedOnly((v) => !v)}
        >
          {releasedOnly ? "Released only" : "All statuses"}
        </button>
        <label style={{ fontSize: 13.5, color: "var(--muted)" }}>
          From{" "}
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setDayIndex(0);
            }}
          />
        </label>
        {from !== asOf && (
          <button
            type="button"
            onClick={() => {
              setFrom(asOf);
              setDayIndex(0);
            }}
          >
            Back to today
          </button>
        )}
      </div>

      <div className="legend">
        {[...colourForLocation.entries()].map(([code, colour]) => (
          <span key={code}>
            <i className="swatch" style={{ background: colour }} />
            {code}
          </span>
        ))}
        <span>
          <i className="swatch" style={{ background: "var(--late)" }} />
          no work centre
        </span>
      </div>

      {days.length === 0 ? (
        <p className="empty">No orders due on or after this date.</p>
      ) : (
        <>
          <div className="day-bar">
            <button type="button" onClick={() => setDayIndex(index - 1)} disabled={index === 0}>
              ← Previous
            </button>
            <h2 className="day-title">
              {day.key === NO_DATE ? "No due date" : formatDayHeading(day.key)}
            </h2>
            <button
              type="button"
              onClick={() => setDayIndex(index + 1)}
              disabled={index >= days.length - 1}
            >
              Next →
            </button>
            <span className="count">
              day {index + 1} of {days.length} · {day.orders.length} order
              {day.orders.length === 1 ? "" : "s"}
            </span>
          </div>

          {columns.length === 0 ? (
            <p className="empty">No orders on this day for the selected centres.</p>
          ) : (
            <div className="columns">
              {columns.map((column) => (
                <section key={column.workCenter} className="wc-column">
                  <h3
                    className={
                      column.category === "unassigned" ? "wc-head unassigned" : "wc-head"
                    }
                  >
                    <span>{column.workCenter}</span>
                    <span>{column.orders.length}</span>
                  </h3>
                  <div className="wc-body">
                    {column.orders.map((order) => (
                      <OrderCard
                        key={order.no}
                        order={order}
                        components={componentsByOrder[order.no] ?? []}
                        colour={colourForLocation.get(order.locationCode)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function OrderCard({
  order,
  components,
  colour,
}: {
  order: OrderWithWorkCenter;
  components: ProdOrderComponent[];
  colour?: string;
}) {
  const noWorkCenter = order.workCenter === "" || order.workCenter === UNASSIGNED;

  return (
    <article
      className={noWorkCenter ? "order-card no-wc" : "order-card"}
      style={colour ? ({ "--loc": colour } as React.CSSProperties) : undefined}
    >
      <div className="top">
        <Link className="no" href={`/components?order=${encodeURIComponent(order.no)}`}>
          {order.no}
        </Link>
        {!order.scheduled && (
          <span className="pill" title="Not scheduled by VAPS">
            unscheduled
          </span>
        )}
      </div>

      {order.description && <p className="desc">{order.description}</p>}

      <div className="meta">
        <span className="qty">Qty {formatNumber(order.quantity)}</span>
        <span>{order.locationCode}</span>
      </div>

      {components.length > 0 && (
        <details>
          <summary>Components ({components.length})</summary>
          <ul className="comp-list">
            {components.map((component) => (
              <li key={`${component.prodOrderLineNo}-${component.lineNo}`}>
                <span className="item" title={component.description}>
                  {component.itemNo} {component.description}
                </span>
                <span className={component.completelyPicked ? "cqty picked" : "cqty"}>
                  {formatNumber(component.remainingQuantity)} {component.unitOfMeasureCode}
                  {component.completelyPicked ? " ✓" : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
