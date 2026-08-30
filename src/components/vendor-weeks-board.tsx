"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable, { type Column, type ExportSheet } from "@/components/data-table";
import DateFilterBox from "@/components/date-filter-box";
import VendorWeekPanel from "@/components/vendor-week-panel";
import {
  groupByVendorWeek,
  weeksIn,
  type UnitTotal,
  type VendorLine,
  type VendorWeek,
} from "@/lib/vendor-weeks";
import { isShort } from "@/lib/component-groups";
import { groupLinesByItem } from "@/lib/item-groups";
import { parseDateFilter } from "@/lib/date-filter";
import { compactQuantity, formatNumber, formatWeekRange } from "@/lib/format";
import {
  initialWeekIndex,
  isPastWeek,
  sundayOf,
  weekLabel,
  weekSpan,
  weeksMatching,
} from "@/lib/weeks";

/** What a row with no supplier says. Never blank - a gap reads as a bug. */
const NO_VENDOR_LABEL = "No vendor set";

/**
 * The exact quantity and its unit - for the filter, the Excel export and the
 * hover title.
 *
 * One unit reads "12,681.926 (KG)". More than one is listed rather than added,
 * because the sum of kilos and bottles is not a quantity of anything.
 */
function quantityText(units: UnitTotal[]): string {
  if (units.length === 0) return "";
  if (units.length === 1) return `${formatNumber(units[0].quantity)} (${units[0].code})`;
  return units.map((u) => `${formatNumber(u.quantity)} ${u.code}`).join(" + ");
}

/** The same figure shortened, for the screen. */
function quantityShort(units: UnitTotal[]): string {
  if (units.length === 0) return "";
  return units.map((u) => compactQuantity(u.quantity, u.code)).join(" + ");
}

/**
 * One week at a time, with a vendor per row.
 *
 * The week moved out of the table and into a bar above it, the way the
 * schedule pages through days. A Week column made every row repeat the same
 * date, and the question this page answers is asked one week at a time - "what
 * do I owe my suppliers this week" - not "show me every vendor-week at once".
 *
 * The unit is the week rather than the day because that is how buying works: a
 * delivery lands on a day but is placed against a week.
 */
function buildColumns(): Column<VendorWeek>[] {
  const columns: Column<VendorWeek>[] = [
    {
      key: "vendorName",
      width: "260px",
      label: "Vendor",
      cell: (r) => (r.vendorNo ? r.vendorName : NO_VENDOR_LABEL),
      nowrap: true,
      render: (r) =>
        r.vendorNo ? (
          <span title={r.vendorNo}>{r.vendorName}</span>
        ) : (
          // Not a blank and not hidden. 8% of lines are on items nobody is
          // recorded as supplying, which is a purchasing problem this page
          // exists to surface rather than tidy away.
          <span className="pill part">{NO_VENDOR_LABEL}</span>
        ),
    },
    {
      key: "lineCount",
      width: "85px",
      label: "Lines",
      cell: (r) => String(r.lineCount),
      sortValue: (r) => r.lineCount,
      numeric: true,
    },
    {
      key: "orderCount",
      width: "90px",
      label: "Orders",
      cell: (r) => String(r.orderCount),
      sortValue: (r) => r.orderCount,
      numeric: true,
    },
    {
      key: "itemCount",
      width: "85px",
      label: "Items",
      cell: (r) => String(r.itemCount),
      sortValue: (r) => r.itemCount,
      numeric: true,
    },
    {
      key: "remaining",
      // The unit rides along in brackets, and a mixed week carries two lines.
      width: "150px",
      label: "Remaining",
      // The EXACT figure, because this is what the Excel export and the filter
      // see. Only the screen gets the shortened form.
      cell: (r) => quantityText(r.units),
      // The plain sum. Meaningless for a mixed week, but it is only deciding
      // an order here, and the cell shows what the number is actually made of.
      sortValue: (r) => r.remaining,
      numeric: true,
      render: (r) =>
        r.units.length <= 1 ? (
          // Exact on hover. A rounded number with no way back to the real one
          // is a number you cannot check.
          <span title={quantityText(r.units)}>{quantityShort(r.units)}</span>
        ) : (
          // Never one total. Adding 94,500 bottles to 1,047 kilos gives 95,547
          // of nothing.
          <span className="mixed" title={quantityText(r.units)}>
            {r.units.map((u) => (
              <span key={u.code}>{compactQuantity(u.quantity, u.code)}</span>
            ))}
          </span>
        ),
    },
  ];

  return columns;
}

export default function VendorWeeksBoard({
  lines,
  stockKnown,
  asOf,
}: {
  lines: VendorLine[];
  /** Whether the stock feed is complete; when not, nothing may be called short. */
  stockKnown: boolean;
  asOf: string;
}) {
  const [shortOnly, setShortOnly] = useState(false);
  const [unattributedOnly, setUnattributedOnly] = useState(false);
  // Null means "not chosen yet", resolved below to the current week; once the
  // user pages, their choice sticks.
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  const [dateExpr, setDateExpr] = useState("");

  // No dependency: pick state and shortage moved into the panel, where they
  // are per item rather than per line. The identity has to stay stable anyway
  // or DataTable's memoised rows are invalidated on every render.
  const columns = useMemo(() => buildColumns(), []);

  // Null while the box is empty or half-typed, and then no week is filtered
  // out. An expression that does not read yet must not empty the pager.
  const dateMatch = useMemo(
    () => (dateExpr.trim() === "" ? null : parseDateFilter(dateExpr, asOf)),
    [dateExpr, asOf],
  );
  const dateState = dateExpr.trim() === "" ? undefined : dateMatch ? "parsed" : "unparsed";

  // Every week in the data, not the filtered set - otherwise switching on
  // "Short only" would remove weeks from under the pager and move you
  // somewhere else. The DATE filter is different: narrowing the weeks is what
  // it is for, so it applies here.
  const allWeeks = useMemo(() => weeksIn(lines), [lines]);
  const weeks = useMemo(
    () => (dateMatch ? weeksMatching(allWeeks, dateMatch) : allWeeks),
    [allWeeks, dateMatch],
  );
  const defaultIndex = useMemo(() => initialWeekIndex(weeks, asOf), [weeks, asOf]);

  // A new expression means a new set of weeks, and holding position in it would
  // land you on an arbitrary one. Back to the rule: the week you are in, or the
  // first that matched.
  useEffect(() => {
    setWeekIndex(null);
  }, [dateExpr]);

  // Clamped rather than stored back: nothing here shrinks the week list, but a
  // shorter list must never leave the page rendering an undefined week.
  const index =
    weeks.length === 0 ? 0 : Math.min(Math.max(weekIndex ?? defaultIndex, 0), weeks.length - 1);
  const week = weeks[index] ?? "";

  const rows = useMemo(() => {
    // Filter the lines, then group - the other way round would count lines the
    // filter had already excluded, so a row would disagree with its own panel.
    const kept = lines.filter((line) => {
      if (line.weekStart !== week) return false;
      if (unattributedOnly && line.vendorNo) return false;
      if (shortOnly && stockKnown && !isShort(line)) return false;
      return true;
    });
    return groupByVendorWeek(kept, stockKnown);
  }, [lines, week, shortOnly, unattributedOnly, stockKnown]);

  // Stable, so DataTable's memoised rows survive a panel opening. An inline
  // arrow here is a new function every render, which invalidates all of them.
  const renderPanel = useCallback(
    (row: VendorWeek, close: () => void) => (
      <VendorWeekPanel group={row} stockKnown={stockKnown} onClose={close} />
    ),
    [stockKnown],
  );

  /**
   * The two levels under each row, as their own sheets.
   *
   * Built from the rows the export is writing, NOT from this component's own
   * `rows` - the column filters live inside DataTable, so filtering to one
   * vendor has to reach the detail sheets too or the workbook contradicts
   * itself. Filter the Vendor column, export, and all three sheets are that
   * vendor.
   *
   * Dates go out as ISO rather than "31 Aug 2026", because these sheets exist
   * to be sorted and pivoted and a formatted date is text that sorts
   * alphabetically - the summary sheet has no date column of its own, so
   * nothing in the workbook disagrees.
   */
  const exportExtra = useCallback((visible: VendorWeek[]): ExportSheet[] => {
    const items: ExportSheet["rows"] = [];
    const lines: ExportSheet["rows"] = [];

    for (const row of visible) {
      const vendor = row.vendorNo ? row.vendorName : "No vendor set";
      for (const item of groupLinesByItem(row.lines, stockKnown)) {
        items.push({
          "Vendor No.": row.vendorNo,
          Vendor: vendor,
          Week: row.weekNo,
          "Week starting": row.weekStart,
          "Item No.": item.itemNo,
          Description: item.description,
          UoM: item.unitOfMeasureCode,
          Orders: item.orderCount,
          Needed: item.earliestNeeded ?? "",
          Quantity: item.remaining,
          "In Stock": stockKnown ? item.available : "",
          "Short By": stockKnown ? item.shortBy : "",
          "Next Delivery": item.nextReceipt ?? "",
        });

        for (const line of item.lines) {
          lines.push({
            "Vendor No.": row.vendorNo,
            Vendor: vendor,
            Week: row.weekNo,
            "Week starting": row.weekStart,
            "Prod. Order No.": line.prodOrderNo,
            "Item No.": line.itemNo,
            Description: line.description,
            "Work Center": line.workCenter,
            UoM: line.unitOfMeasureCode,
            Needed: line.dueDate ?? "",
            Quantity: line.remainingQuantity,
            Picked: line.qtyPicked,
            "Fully Picked": line.completelyPicked ? "Yes" : "No",
          });
        }
      }
    }

    return [
      { name: "Items", rows: items },
      { name: "Lines", rows: lines },
    ];
  }, [stockKnown]);

  // Counted for this week only - the button says what it will hide here, and a
  // count from the whole board would not match what removing it does.
  const unattributed = useMemo(
    () => lines.filter((l) => l.weekStart === week && !l.vendorNo).length,
    [lines, week],
  );
  const weekLines = useMemo(
    () => lines.filter((l) => l.weekStart === week).length,
    [lines, week],
  );

  const span = weekSpan(weeks);

  if (weeks.length === 0) {
    return (
      <>
        <div className="day-bar">
          <DateFilterBox
            value={dateExpr}
            onChange={setDateExpr}
            state={dateState}
            ariaLabel="Filter weeks"
            style={{ width: 168 }}
          />
          <h2 className="day-title">No weeks</h2>
        </div>
        <p className="empty">
          {allWeeks.length === 0
            ? "No component lines to schedule."
            : "No week matches that date filter."}
        </p>
      </>
    );
  }

  return (
    <>
      {/* Same bar as the schedule's day pager, one unit up. Sticky under the
          site header, so paging stays reachable down a long vendor list. */}
      <div className="day-bar">
        {/* The date box decides which weeks exist; Previous and Next walk what
            is left. A single date lands on the week containing it, because a
            week matches when any of its days does. */}
        <DateFilterBox
          value={dateExpr}
          onChange={setDateExpr}
          state={dateState}
          ariaLabel="Filter weeks"
          style={{ width: 168 }}
        />
        <button type="button" onClick={() => setWeekIndex(index - 1)} disabled={index === 0}>
          ← Previous
        </button>
        <h2 className="day-title">
          {week ? (
            <>
              <span className="wk">{weekLabel(week)}</span> {formatWeekRange(week, sundayOf(week))}
            </>
          ) : (
            "No date"
          )}
        </h2>
        <button
          type="button"
          onClick={() => setWeekIndex(index + 1)}
          disabled={index >= weeks.length - 1}
        >
          Next →
        </button>
        {week && isPastWeek(week, asOf) && <span className="pill late">past</span>}
        <span className="count">
          week {index + 1} of {weeks.length} · {weekLines.toLocaleString("en-GB")} line
          {weekLines === 1 ? "" : "s"}
          {/* The span of what the filter left, in whole weeks - someone who
              asked for "this month" is looking at six whole weeks, and naming
              the month would describe a narrower period than the screen. */}
          {dateMatch && weeks.length > 1 && span && (
            <>
              {" · "}
              {weeks.length} weeks, {formatWeekRange(span.from, span.to)}
            </>
          )}
        </span>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        exportName={`vendors-${week || "no-date"}`}
        emptyMessage="No component lines this week for the current filters."
        defaultSort={{ key: "lineCount", dir: "desc" }}
        expand={renderPanel}
        exportExtra={exportExtra}
        asOf={asOf}
        toolbar={
          <>
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
            {unattributed > 0 && (
              <button
                type="button"
                className={unattributedOnly ? "on" : undefined}
                onClick={() => setUnattributedOnly((v) => !v)}
                title="Component lines whose item has no Vendor No. set in Business Central."
              >
                No vendor ({unattributed})
              </button>
            )}
          </>
        }
      />
    </>
  );
}
