"use client";

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { pageWindow } from "@/lib/paging";
import {
  DATE_FILTER_HELP,
  DATE_FILTER_PLACEHOLDER,
  parseDateFilter,
} from "@/lib/date-filter";

export type Column<T> = {
  key: string;
  label: string;
  /**
   * The cell as plain text. This is the single source of truth for filtering,
   * sorting and the Excel export, so what you search and what you download are
   * always exactly what is on screen.
   */
  cell: (row: T) => string;
  /** Optional richer rendering (a link, a pill). Falls back to `cell`. */
  render?: (row: T) => ReactNode;
  /**
   * Sort key, when sorting on the displayed text would be wrong - dates being
   * the obvious case, where "24 Jun 2026" sorts alphabetically.
   */
  sortValue?: (row: T) => string | number;
  numeric?: boolean;
  wrap?: boolean;
  nowrap?: boolean;
  /**
   * Column width, as a CSS length. The outer table is `table-layout: fixed`,
   * so these are what decide the columns - the browser never measures the
   * cells. That is the point: with auto layout, inserting the detail row
   * made it re-measure every cell in the table to place one panel.
   *
   * Leave it out and the column splits whatever space is left, which is only
   * predictable if at most one column does so.
   */
  width?: string;
  /**
   * How this column filters. Left out, it picks itself: a dropdown of the
   * values actually present when there are few enough to choose from, a text
   * box when there are not. Set it to force one - a column of 40 dates reads
   * better as "type Sep" than as a list of forty.
   *
   * "date" opts into the date language - 300826, cw, lm, >=010826,
   * 200826..300826 - and REQUIRES `sortValue` to return the row's ISO date,
   * because that is what it filters on. The displayed text is a human date
   * and cannot be compared.
   */
  filter?: "select" | "text" | "date";
};

type SortState = { key: string; dir: "asc" | "desc" };

/**
 * Rows on a page.
 *
 * The board's tables run to 703 and 982 rows, and the cost of a table is paid
 * per row on every layout: opening a panel, sorting, resizing the window. Fifty
 * is enough to read a screenful and scroll a little without the table becoming
 * the slowest thing on the page.
 */
const PAGE_SIZE = 50;

/**
 * Above this many distinct values, a column filters by typing instead.
 *
 * A dropdown is only easier than a text box while you can take in the whole
 * list. Work centre has ten values and brand thirteen, so those are a real
 * choice; production order number has 982, which is a scroll, not a menu.
 */
const CHOICE_LIMIT = 30;

export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  exportName,
  toolbar,
  emptyMessage = "No rows.",
  expand,
  asOf,
  defaultSort = null,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  /** Base file name for the Excel export, without extension. */
  exportName: string;
  /** Page-specific controls, shown to the left of the search box. */
  toolbar?: ReactNode;
  emptyMessage?: string;
  /**
   * Today, for the date filter's relative terms - cw, lm and the rest. Passed
   * in rather than read off the clock so the whole board agrees about it.
   */
  asOf?: string;
  /**
   * Detail panel for a row. Supplying it makes every row expandable: a caret
   * appears at the left and clicking anywhere in the row opens the panel
   * underneath. Left out, the table behaves exactly as before.
   */
  expand?: (row: T) => ReactNode;
  /** Sort applied before the user touches a header. */
  defaultSort?: SortState | null;
}) {
  const [filter, setFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState | null>(defaultSort);
  // Keyed on the row key, not the index, so sorting or filtering the table
  // does not move the open panel onto a different order.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [page, setPage] = useState(0);

  /**
   * The dropdown options per column, where a dropdown makes sense.
   *
   * Built from every row, not the filtered ones, so choosing a work centre
   * does not empty the brand list and strand you with nothing to pick. A
   * column absent from this map filters by typing.
   */
  const choices = useMemo(() => {
    const byColumn = new Map<string, string[]>();

    for (const column of columns) {
      if (column.filter === "text" || column.filter === "date") continue;
      const seen = new Set<string>();
      let overflowed = false;

      for (const row of rows) {
        const value = column.cell(row).trim();
        if (value === "") continue;
        seen.add(value);
        if (seen.size > CHOICE_LIMIT && column.filter !== "select") {
          overflowed = true;
          break;
        }
      }

      if (overflowed || seen.size === 0) continue;
      byColumn.set(
        column.key,
        [...seen].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
        ),
      );
    }

    return byColumn;
  }, [rows, columns]);

  /**
   * The compiled date expressions, by column.
   *
   * A column whose box holds something that does not parse is absent here,
   * and the filter is simply not applied - a date is half-typed for most of
   * the keystrokes it takes, and blanking the table in between helps nobody.
   */
  const dateMatchers = useMemo(() => {
    const today = asOf ?? new Date().toISOString().slice(0, 10);
    const byColumn = new Map<string, ReturnType<typeof parseDateFilter>>();
    for (const column of columns) {
      if (column.filter !== "date") continue;
      const typed = columnFilters[column.key] ?? "";
      if (typed.trim() === "") continue;
      byColumn.set(column.key, parseDateFilter(typed, today));
    }
    return byColumn;
  }, [columns, columnFilters, asOf]);

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const active = Object.entries(columnFilters).filter(([, v]) => v.trim() !== "");

    return rows.filter((row) => {
      if (query && !columns.some((c) => c.cell(row).toLowerCase().includes(query))) {
        return false;
      }
      return active.every(([key, value]) => {
        const column = columns.find((c) => c.key === key);
        if (!column) return true;
        // A date column compares the underlying ISO date, never the words on
        // screen. "30 Aug 2026" cannot be compared with anything.
        if (column.filter === "date") {
          const match = dateMatchers.get(key);
          if (!match) return true;
          return match(String(column.sortValue?.(row) ?? ""));
        }

        const cell = column.cell(row);
        // A value picked from a list is that value, not anything containing
        // it: substring matching would make choosing PROD-1 also select
        // PROD-1 through PROD-7 at once. Typed text stays a substring, which
        // is what makes typing "Sep" into a date column useful.
        if (choices.has(key)) return cell === value;
        return cell.toLowerCase().includes(value.trim().toLowerCase());
      });
    });
  }, [rows, columns, filter, columnFilters, choices, dateMatchers]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return filtered;
    const factor = sort.dir === "asc" ? 1 : -1;

    return [...filtered].sort((a, b) => {
      const av = column.sortValue ? column.sortValue(a) : column.cell(a);
      const bv = column.sortValue ? column.sortValue(b) : column.cell(b);

      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;

      // Blanks last whichever way the sort runs - an empty due date is not
      // "earliest", it is unknown, and it should not head the list.
      const as = String(av);
      const bs = String(bv);
      if (as === "" && bs !== "") return 1;
      if (bs === "" && as !== "") return -1;
      return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" }) * factor;
    });
  }, [filtered, columns, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Clamped rather than stored back: a filter can shrink the table under a
  // page that is already showing, and rendering nothing is worse than moving.
  const current = Math.min(page, pageCount - 1);
  const from = current * PAGE_SIZE;
  const visible = useMemo(() => sorted.slice(from, from + PAGE_SIZE), [sorted, from]);

  // Filtering or sorting changes what page 3 even means, so go back to the
  // start instead of leaving someone on an arbitrary slice of a new list.
  useEffect(() => {
    setPage(0);
  }, [rows, filter, columnFilters, sort]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears it
    });
  }

  async function exportToExcel() {
    // Loaded on demand - xlsx is large and most viewers never export.
    //
    // Every filtered row, not the page. Paging is a rendering budget, not part
    // of what you asked for - downloading 50 of 703 because of where you happen
    // to be standing would be a trap.
    const XLSX = await import("xlsx");
    const data = sorted.map((row) => {
      const record: Record<string, string> = {};
      for (const column of columns) record[column.label] = column.cell(row);
      return record;
    });
    const sheet = XLSX.utils.json_to_sheet(data, { header: columns.map((c) => c.label) });
    const book = XLSX.utils.book_new();
    // Excel caps sheet names at 31 characters.
    XLSX.utils.book_append_sheet(book, sheet, exportName.slice(0, 31));
    XLSX.writeFile(book, `${exportName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // Stable identity, so the memoised rows below are not invalidated by it on
  // every render. The functional update means it needs no dependencies.
  const toggleRow = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const hasColumnFilters = Object.values(columnFilters).some((v) => v.trim() !== "");

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        {toolbar}
        <input
          type="search"
          placeholder="Filter all columns…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 220 }}
          aria-label="Filter all columns"
        />
        {(hasColumnFilters || filter) && (
          <button
            type="button"
            onClick={() => {
              setColumnFilters({});
              setFilter("");
            }}
          >
            Clear filters
          </button>
        )}
        <button type="button" onClick={exportToExcel} disabled={sorted.length === 0}>
          Export to Excel
        </button>
        {pageCount === 1 && (
          <span className="count">
            {sorted.length.toLocaleString("en-GB")}
            {sorted.length !== rows.length ? ` of ${rows.length.toLocaleString("en-GB")}` : ""} rows
          </span>
        )}
      </div>

      <Pager
        label="Pages"
        current={current}
        pageCount={pageCount}
        from={from}
        total={sorted.length}
        onGo={setPage}
      />

      {rows.length === 0 ? (
        <p className="empty">{emptyMessage}</p>
      ) : (
        <div className="table-wrap">
          <table>
            {/* Fixed layout takes the columns from here and stops measuring
                cells, so opening a row no longer re-lays-out the table. */}
            <colgroup>
              {expand && <col style={{ width: "34px" }} />}
              {columns.map((column) => (
                <col key={column.key} style={column.width ? { width: column.width } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {expand && <th className="exp" scope="col" aria-label="Expand" />}
                {columns.map((column) => {
                  const active = sort?.key === column.key;
                  return (
                    <th key={column.key} scope="col">
                      <button
                        type="button"
                        className="sort"
                        onClick={() => toggleSort(column.key)}
                        title={`Sort by ${column.label}`}
                      >
                        {column.label}
                        <span className={active ? "arrow active" : "arrow"}>
                          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
              <tr>
                {expand && <th className="exp" />}
                {columns.map((column) => {
                  const options = choices.get(column.key);
                  const typed = (columnFilters[column.key] ?? "").trim();
                  const onPick = (value: string) =>
                    setColumnFilters((prev) => ({ ...prev, [column.key]: value }));

                  // Green once the expression reads as something, red while it
                  // does not. It is one fact either way: whether the box is
                  // filtering. Only date columns have anything to get wrong -
                  // a plain text box is a substring and is never invalid.
                  const state =
                    column.filter !== "date" || typed === ""
                      ? undefined
                      : dateMatchers.get(column.key)
                        ? "parsed"
                        : "unparsed";

                  return (
                    <th key={column.key}>
                      {options ? (
                        <select
                          value={columnFilters[column.key] ?? ""}
                          onChange={(e) => onPick(e.target.value)}
                          aria-label={`Filter ${column.label}`}
                        >
                          <option value="">All</option>
                          {options.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className={state}
                          placeholder={
                            column.filter === "date" ? DATE_FILTER_PLACEHOLDER : "Filter…"
                          }
                          title={
                            column.filter === "date"
                              ? DATE_FILTER_HELP
                              : `Filter ${column.label}`
                          }
                          value={columnFilters[column.key] ?? ""}
                          onChange={(e) => onPick(e.target.value)}
                          aria-label={`Filter ${column.label}`}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => {
                const key = rowKey(row, from + index);
                return (
                  <TableRow
                    key={key}
                    rowId={key}
                    row={row}
                    columns={columns}
                    isOpen={open.has(key)}
                    onToggle={toggleRow}
                    expand={expand}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && sorted.length === 0 && (
        <p className="empty">No rows match the current filters.</p>
      )}

      <Pager
        label="Pages, bottom"
        current={current}
        pageCount={pageCount}
        from={from}
        total={sorted.length}
        onGo={setPage}
      />
    </>
  );
}

/**
 * One row, memoised.
 *
 * Opening a panel changes the state of a single row, but without this every row
 * in the table re-renders to do it. The component list is 703 rows of 13 cells,
 * so one click was reconciling about nine thousand elements in order to turn a
 * caret round, and the open felt as slow as it sounds.
 *
 * memo only holds if the props keep their identities between renders, so
 * `columns`, `expand` and `onToggle` all have to be stable in their owners -
 * an inline arrow for `expand` silently undoes the whole thing.
 */
function TableRowInner<T>({
  row,
  rowId,
  columns,
  isOpen,
  onToggle,
  expand,
}: {
  row: T;
  rowId: string;
  columns: Column<T>[];
  isOpen: boolean;
  onToggle: (key: string) => void;
  expand?: (row: T) => ReactNode;
}) {
  const cells = columns.map((column) => (
    <td
      key={column.key}
      className={[
        column.numeric ? "num" : "",
        column.wrap ? "wrap" : "",
        column.nowrap ? "nowrap" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {column.render ? column.render(row) : column.cell(row)}
    </td>
  ));

  if (!expand) return <tr>{cells}</tr>;

  return (
    <>
      <tr
        className={isOpen ? "ord open" : "ord"}
        tabIndex={0}
        role="button"
        aria-expanded={isOpen}
        onClick={(e) => {
          // A link or a button inside the row does its own job. Swallowing that
          // click would make the cell look broken.
          if ((e.target as HTMLElement).closest("a, button, input")) return;
          onToggle(rowId);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onToggle(rowId);
        }}
      >
        <td className="exp">
          <span className="caret">{isOpen ? "▼" : "▶"}</span>
        </td>
        {cells}
      </tr>
      {isOpen && (
        <tr className="det">
          <td colSpan={columns.length + 1}>{expand(row)}</td>
        </tr>
      )}
    </>
  );
}

// memo() erases the generic. The cast puts it back, so callers still get their
// row type checked against the columns they pass.
const TableRow = memo(TableRowInner) as typeof TableRowInner;

/**
 * Previous, a window of page numbers, next, and where you are.
 *
 * Drawn above and below the table. Fifty rows is a screenful and a half, so a
 * pager only at the bottom means scrolling past everything to leave the page.
 */
function Pager({
  label,
  current,
  pageCount,
  from,
  total,
  onGo,
}: {
  label: string;
  current: number;
  pageCount: number;
  from: number;
  total: number;
  onGo: (page: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav className="pager" aria-label={label}>
      <button type="button" onClick={() => onGo(current - 1)} disabled={current === 0}>
        ‹ Previous
      </button>

      {pageWindow(current, pageCount).map((page, i) =>
        page === null ? (
          <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={page}
            type="button"
            className={page === current ? "on" : undefined}
            aria-current={page === current ? "page" : undefined}
            onClick={() => onGo(page)}
          >
            {page + 1}
          </button>
        ),
      )}

      <button type="button" onClick={() => onGo(current + 1)} disabled={current >= pageCount - 1}>
        Next ›
      </button>

      <span className="count">
        {(from + 1).toLocaleString("en-GB")}–{Math.min(from + PAGE_SIZE, total).toLocaleString("en-GB")}{" "}
        of {total.toLocaleString("en-GB")}
      </span>
    </nav>
  );
}
