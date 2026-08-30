"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardOrder, ComponentLine } from "@/lib/types";
import { completionOf, pickStateLabel, type PickState } from "@/lib/chain";
import {
  DATE_FILTER_HELP,
  DATE_FILTER_PLACEHOLDER,
  parseDateFilter,
} from "@/lib/date-filter";
import { floorLabel, floorTone } from "@/lib/floor";
import { formatDate, formatDayHeading, formatNumber } from "@/lib/format";
import {
  groupByDay,
  initialDayIndex,
  locationsIn,
  toWorkCenterColumns,
  workCentersIn,
  NO_DATE,
} from "@/lib/schedule";
import { UNASSIGNED, centersOf, hasVisibleCenter } from "@/lib/work-center";

// One colour per location so a card's origin is readable at a glance from
// across the room, which is how this board actually gets used.
const LOCATION_COLOURS = ["#c9ada7", "#7fa6c9", "#8fcf9b", "#e0c074", "#c19ad8", "#6fc5c5"];

// Which pill style each pick state wears. "Can pick" is green because it is the
// one that needs no attention; the other two are the ones to act on.
/** What the "From today" button puts in the box. Everything from today on. */
const FROM_TODAY = ">=cd";

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
  componentsByOrder: Record<string, ComponentLine[]>;
  /** How many component lines are short, keyed by production order number. */
  shortagesByOrder: Record<string, number>;
  /** Pick state per order. Empty when the stock feed is incomplete. */
  pickStateByOrder: Record<string, PickState>;
  asOf: string;
}) {
  // Which centres are switched OFF, not which are on. Storing the exclusions
  // means a work centre that appears in BC tomorrow shows up by default instead
  // of being silently absent because it was not in a list saved today.
  const [hidden, setHidden] = useState<string[]>([]);
  // The date filter stays off. Defaulting it to today would hide the backlog
  // completely, and a production schedule that silently omits every late order
  // is worse than useless - it looks reassuringly empty.
  //
  // It was a native date picker, which could only ever express one thing: a
  // lower bound. The tables already speak a date language, and the questions
  // asked of a schedule are the ones it is for - this week, the next seven
  // days, everything after the month end - so the box takes an expression.
  const [dateExpr, setDateExpr] = useState("");
  // Which day you LAND on is a separate question from what is visible, and
  // nothing is hidden by it. Null means "not chosen yet", resolved below to
  // today; once the user pages, their choice sticks.
  const [dayIndex, setDayIndex] = useState<number | null>(null);

  // Null while the box is empty or half-typed, and then nothing is filtered.
  // An expression that does not read yet must not empty the board.
  const dateMatch = useMemo(
    () => (dateExpr.trim() === "" ? null : parseDateFilter(dateExpr, asOf)),
    [dateExpr, asOf],
  );
  const dateState = dateExpr.trim() === "" ? undefined : dateMatch ? "parsed" : "unparsed";

  const colourForLocation = useMemo(() => {
    const locations = locationsIn(orders);
    const map = new Map<string, string>();
    locations.forEach((code, i) => map.set(code, LOCATION_COLOURS[i % LOCATION_COLOURS.length]));
    return map;
  }, [orders]);

  // Every centre in the data, not just today's - see workCentersIn.
  const centres = useMemo(() => workCentersIn(orders), [orders]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  // Split in two so the chip counts can reflect the status and date filters
  // without counting the centre filter against itself - a chip reading 0
  // because you switched it off tells you nothing.
  const beforeCentres = useMemo(
    () =>
      orders.filter((order) => {
        // An order with no scheduled start cannot sit on a day, so a date
        // filter necessarily excludes it - which is what every matcher does
        // with a blank date anyway.
        if (dateMatch && !dateMatch(order.scheduledStart ?? "")) return false;
        return true;
      }),
    [orders, dateMatch],
  );

  const countByCentre = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of beforeCentres) {
      // An order spanning two centres counts in both, exactly as it appears in
      // both columns.
      for (const centre of centersOf(order.workCenter)) {
        counts.set(centre, (counts.get(centre) ?? 0) + 1);
      }
    }
    return counts;
  }, [beforeCentres]);

  const visible = useMemo(
    () => beforeCentres.filter((order) => hasVisibleCenter(order.workCenter, hiddenSet)),
    [beforeCentres, hiddenSet],
  );

  const days = useMemo(() => groupByDay(visible), [visible]);

  const defaultIndex = useMemo(() => initialDayIndex(days, asOf), [days, asOf]);

  // Filters can shrink the list under the current index, so clamp rather than
  // reset - staying near the day you were looking at is less disorienting.
  const index =
    days.length === 0 ? 0 : Math.min(Math.max(dayIndex ?? defaultIndex, 0), days.length - 1);
  const day = days[index];

  const columns = useMemo(
    () => (day ? toWorkCenterColumns(day.orders, hiddenSet) : []),
    [day, hiddenSet],
  );

  const allHidden = centres.length > 0 && hidden.length === centres.length;

  function toggleCentre(centre: string) {
    setHidden((current) =>
      current.includes(centre) ? current.filter((c) => c !== centre) : [...current, centre],
    );
  }

  const [centresOpen, setCentresOpen] = useState(false);
  const centresRef = useRef<HTMLDivElement>(null);

  // Close on a click anywhere else, or on Escape. Without both, the panel sits
  // over the board and the only way out is to find the button again.
  useEffect(() => {
    if (!centresOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!centresRef.current?.contains(event.target as Node)) setCentresOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCentresOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [centresOpen]);

  // What the closed button says. Naming the single centre when only one is on
  // is the case worth spelling out - "1 of 10" would make you open it to find
  // out which.
  const shownCentres = centres.filter((centre) => !hiddenSet.has(centre));
  const centresLabel =
    hidden.length === 0
      ? "All centres"
      : shownCentres.length === 0
        ? "None"
        : shownCentres.length === 1
          ? shownCentres[0]
          : `${shownCentres.length} of ${centres.length}`;

  // --- pinned state --------------------------------------------------------
  //
  // CSS has no :stuck selector, so a 1px sentinel sits immediately above the
  // day bar and an IntersectionObserver reports when it leaves the top of the
  // viewport. That is the moment the day bar pins, and the column headers pin
  // with it - they sit 6px below, so treating them as one state is accurate.
  const [pinned, setPinned] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const boardVisible = !allHidden && days.length > 0;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) {
      // The board is filtered away entirely; nothing can be pinned.
      setPinned(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setPinned(!entry.isIntersecting),
      // The day bar pins at 54px, not 0, because the site header sits there and
      // is sticky too. Pulling the observation area down by the same amount is
      // what makes the state flip at the moment it actually pins rather than a
      // header's height later.
      { threshold: 0, rootMargin: "-54px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [boardVisible]);

  return (
    <div className={pinned ? "board pinned" : "board"}>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <div className="dropdown" ref={centresRef}>
          <button
            type="button"
            className={hidden.length > 0 ? "on" : undefined}
            onClick={() => setCentresOpen((open) => !open)}
            aria-expanded={centresOpen}
            aria-haspopup="true"
          >
            Work centres: {centresLabel} ▾
          </button>

          {centresOpen && (
            <div className="dropdown-menu">
              <div className="dropdown-actions">
                <button type="button" onClick={() => setHidden([])}>
                  All
                </button>
                <button type="button" onClick={() => setHidden(centres)}>
                  None
                </button>
              </div>
              {centres.map((centre) => (
                <label key={centre} className="dropdown-item">
                  <input
                    type="checkbox"
                    checked={!hiddenSet.has(centre)}
                    onChange={() => toggleCentre(centre)}
                  />
                  <span>{centre === UNASSIGNED ? "No work centre" : centre}</span>
                  {/* The count is what makes this a decision rather than a
                      guess - you can see what switching a centre off removes. */}
                  <span className="count">{countByCentre.get(centre) ?? 0}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <label style={{ fontSize: 13.5, color: "var(--muted)" }}>
          Dates{" "}
          <input
            type="text"
            className={dateState}
            style={{ width: 160 }}
            value={dateExpr}
            placeholder={DATE_FILTER_PLACEHOLDER}
            title={DATE_FILTER_HELP}
            aria-label="Filter days"
            onChange={(e) => {
              setDateExpr(e.target.value);
              setDayIndex(0);
            }}
          />
        </label>
        <button
          type="button"
          className={dateExpr === FROM_TODAY ? "on" : undefined}
          onClick={() => {
            setDateExpr(dateExpr === FROM_TODAY ? "" : FROM_TODAY);
            setDayIndex(0);
          }}
        >
          {dateExpr === FROM_TODAY ? "Showing from today" : "From today"}
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

      {allHidden ? (
        <p className="empty">Every work centre is switched off. Turn one back on to see the board.</p>
      ) : days.length === 0 ? (
        <p className="empty">No orders planned on or after this date.</p>
      ) : (
        <>
          {/* Watched by the IntersectionObserver above - it marks the exact
              scroll position at which the day bar starts sticking. */}
          <div className="stick-sentinel" ref={sentinelRef} aria-hidden="true" />
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
    </div>
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
  components: ComponentLine[];
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
        {/* Always the shop-floor state, "Not started" included. It used to show
            only for orders on the line and otherwise fell back to an
            "unscheduled" pill driven by NETVAPS Scheduled - a field no
            published page exposes, so it read false everywhere and that pill
            appeared on every card that was not currently running. */}
        <span
          className={`fl fl-${floorTone(order.floor.status) || "none"}`}
          title={
            order.floor.operator
              ? `${floorLabel(order.floor.status)} — ${order.floor.operator}`
              : floorLabel(order.floor.status)
          }
        >
          {floorLabel(order.floor.status)}
        </span>
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
