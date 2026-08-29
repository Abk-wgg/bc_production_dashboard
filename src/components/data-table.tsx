"use client";

import { useMemo, useState, type ReactNode } from "react";

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
};

type SortState = { key: string; dir: "asc" | "desc" };

export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  exportName,
  toolbar,
  emptyMessage = "No rows.",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  /** Base file name for the Excel export, without extension. */
  exportName: string;
  /** Page-specific controls, shown to the left of the search box. */
  toolbar?: ReactNode;
  emptyMessage?: string;
}) {
  const [filter, setFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState | null>(null);

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
        return column.cell(row).toLowerCase().includes(value.trim().toLowerCase());
      });
    });
  }, [rows, columns, filter, columnFilters]);

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

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears it
    });
  }

  async function exportToExcel() {
    // Loaded on demand - xlsx is large and most viewers never export.
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
        <span className="count">
          {sorted.length.toLocaleString("en-GB")}
          {sorted.length !== rows.length ? ` of ${rows.length.toLocaleString("en-GB")}` : ""} rows
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="empty">{emptyMessage}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
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
                {columns.map((column) => (
                  <th key={column.key}>
                    <input
                      type="text"
                      placeholder="Filter…"
                      value={columnFilters[column.key] ?? ""}
                      onChange={(e) =>
                        setColumnFilters((prev) => ({ ...prev, [column.key]: e.target.value }))
                      }
                      aria-label={`Filter ${column.label}`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, index) => (
                <tr key={rowKey(row, index)}>
                  {columns.map((column) => (
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
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && sorted.length === 0 && (
        <p className="empty">No rows match the current filters.</p>
      )}
    </>
  );
}
