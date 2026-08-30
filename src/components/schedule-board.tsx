"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BoardOrder, ProdOrderComponent } from "@/lib/types";
import { completionOf, pickStateLabel, type PickState } from "@/lib/chain";
import { RELEASED } from "@/lib/status";
import { floorLabel, floorTone, isOnTheLine } from "@/lib/floor";
import { formatDate, formatDayHeading, formatNumber } from "@/lib/format";
import { groupByDay, locationsIn, toWorkCenterColumns, NO_DATE } from "@/lib/schedule";
import { UNASSIGNED, orderHasCategory } from "@/lib/work-center";

// One colour per location so a card's origin is readable at a glance from
// across the room, which is how this board actually gets used.
const LOCATION_COLOURS = ["#c9ada7", "#7fa6c9", "#8fcf9b", "#e0c074", "#c19ad8", "#6fc5c5"];

type Category = "production" | "trade" | null;

// Which pill style each pick state wears. "Can pick" is green because it is the
// one that needs no attention; the other two are the ones to act on.
const PICK_TONE: Record<PickState, string> = {
  "can-pick": "ok",
  "some-missing": "part",
  "none-available": "late",
  "nothing-to-pick": "",
};

export default function ScheduleBoard({
  orders,
  componentsByOrder,
  shortagesByOrder,
  pickStateByOrder,
  asOf,
}: {
  orders: BoardOrder[];
  /** Components keyed by production order number. */
  componentsByOrder: Record<string, ProdOrderComponent[]>;
  /** How many component lines are short, keyed by production order number. */
  shortagesByOrder: Record<string, number>;
  /** Pick state per order. Empty when the stock feed is incomplete. */
  pickStateByOrder: Record<string, PickState>;
  asOf: string;
}) {
  const [category, setCategory] = useState<Category>(null);
  const [releasedOnly, setReleasedOnly] = useState(true);
  // Starts at the earliest planned date, not today. Defaulting to today hides the
  // backlog completely, and a production schedule that silently omits every
  // late order is worse than useless - it looks reassuringly empty.
  const [from, setFrom] = useState("");
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
        // An order with no scheduled start cannot sit on a day, so a "from"
        // filter necessarily excludes it.
        if (from && (!order.scheduledStart || order.scheduledStart < from)) return false;
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
        <button
          type="button"
          className={from === asOf ? "on" : undefined}
          onClick={() => {
            setFrom(from === asOf ? "" : asOf);
            setDayIndex(0);
          }}
        >
          {from === asOf ? "Showing from today" : "From today"}
        </button>
      </div>

      <div className="legend">
        {/* Only worth a colour key when there is more than one location to tell
            apart - the board is scoped to PRODUCTION, so usually there is not. */}
        {colourForLocation.size > 1 &&
          [...colourForLocation.entries()].map(([code, colour]) => (
            <span key={code}>
              <i className="swatch" style={{ background: colour }} />
              {code}
            </span>
          ))}
        <span>
          <i className="swatch" style={{ background: "var(--crit)" }} />
          no work centre
        </span>
        <span>
          <i
            className="swatch"
            style={{
              background: "rgba(208, 59, 59, 0.12)",
              border: "1px solid rgba(208, 59, 59, 0.28)",
            }}
          />
          past its planned end
        </span>
      </div>

      {days.length === 0 ? (
        <p className="empty">No orders planned on or after this date.</p>
      ) : (
        <>
          <div className="day-bar">
            <button type="button" onClick={() => setDayIndex(index - 1)} disabled={index === 0}>
              ← Previous
            </button>
            <h2 className="day-title">
              {day.key === NO_DATE ? "Not scheduled" : formatDayHeading(day.key)}
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
                        shortages={shortagesByOrder[order.no] ?? 0}
                        pickState={pickStateByOrder[order.no]}
                        colour={colourForLocation.get(order.locationCode)}
                        asOf={asOf}
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
  shortages,
  pickState,
  colour,
  asOf,
}: {
  order: BoardOrder;
  components: ProdOrderComponent[];
  shortages: number;
  pickState?: PickState;
  colour?: string;
  asOf: string;
}) {
  const noWorkCenter = order.workCenter === "" || order.workCenter === UNASSIGNED;
  // Still on the board, but the plan had it finished before now.
  const late = order.endingDate !== null && order.endingDate < asOf;

  return (
    <article
      className={noWorkCenter ? "order-card no-wc" : "order-card"}
      style={colour ? ({ "--loc": colour } as React.CSSProperties) : undefined}
    >
      <div className="top">
        <Link className="no" href={`/components?order=${encodeURIComponent(order.no)}`}>
          {order.no}
        </Link>
        {isOnTheLine(order.floor.status) ? (
          <span className={`fl fl-${floorTone(order.floor.status)}`}>
            {floorLabel(order.floor.status)}
          </span>
        ) : (
          !order.scheduled && (
            <span className="pill" title="Not scheduled by VAPS">
              unscheduled
            </span>
          )
        )}
      </div>

      {order.description && <p className="desc">{order.description}</p>}
      {order.customerName && <p className="cust">{order.customerName}</p>}

      <div className="meta">
        <span className="qty">Qty {formatNumber(order.quantity)}</span>
        {/* The column heading is the planned START, so the other half of the
            plan - when it is meant to come off the line - belongs on the card
            or it is nowhere. */}
        <span className={late ? "due late" : "due"} title={order.dueDate ? `Due ${formatDate(order.dueDate)}` : undefined}>
          {order.endingDate ? `Ends ${formatDate(order.endingDate)}` : "No planned end"}
        </span>
      </div>

      {order.made > 0 && (
        <div className="card-progress" title={`${formatNumber(order.made)} of ${formatNumber(order.quantity)} made`}>
          <span className="progress-bar">
            <span
              className="progress-fill"
              style={{ width: `${completionOf(order.made, order.quantity) * 100}%` }}
            />
          </span>
          <span>
            {formatNumber(order.made)} made
            {order.scrapped > 0 && `, ${formatNumber(order.scrapped)} scrap`}
          </span>
        </div>
      )}

      {pickState && pickState !== "nothing-to-pick" && (
        <p className="pickstate">
          <span className={`pill ${PICK_TONE[pickState]}`}>{pickStateLabel(pickState)}</span>
          {shortages > 0 && (
            <span className="shortcount">
              {shortages} line{shortages === 1 ? "" : "s"} short
            </span>
          )}
        </p>
      )}

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
