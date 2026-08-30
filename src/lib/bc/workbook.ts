// ---------------------------------------------------------------------------
// The BC warehouse workbooks as a data source.
//
// Wilson George already refreshes Business Central into Excel: Power Query
// pulls each published web service into BC-FEED.xlsx, and a scheduled task on
// NGDT0015 refreshes and saves it. That file holds COMPLETE extracts - every
// released order, every routing line, every component - where the bundled
// snapshot was capped at 1000 rows a table.
//
// So this reads those sheets instead. It is not a second way of talking to BC:
// the columns arrive already in published-web-service form (`Prod_Order_No`,
// `Sales_Order_No`), so the rows go through exactly the same mappers as a live
// OData response. Same board, complete data, no Entra app registration.
//
// What it costs: the refresh runs as a signed-in user with THEIR BC
// credentials, not as the service identity, and the data is as fresh as the
// last scheduled run rather than 60 seconds old. Live credentials always win -
// see fetchService() in client.ts.
// ---------------------------------------------------------------------------

import "server-only";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import * as XLSX from "xlsx";
import type { ServiceKey } from "./client";
import type { RawRow } from "./fields";

/** Which workbook and sheet a feed reads, in order of preference. */
type SheetRef = { file: string; sheet: string };

/** BC-FEED.xlsx - the eight production-side queries. */
function feedFile(): string {
  return process.env.BC_WORKBOOK_FILE || "";
}

/** Sales_order_Despatch_board.xlsx - richer sales orders and lines. */
function salesFile(): string {
  return process.env.BC_SALES_WORKBOOK_FILE || "";
}

/**
 * Vendor card.xlsx - the supplier names.
 *
 * Defaults to the raw-files folder beside the feed, which is where the refresh
 * already puts it, so the names appear without anyone adding a setting. Set
 * BC_VENDOR_WORKBOOK_FILE to point somewhere else.
 */
function vendorFile(): string {
  const explicit = process.env.BC_VENDOR_WORKBOOK_FILE;
  if (explicit) return explicit;
  const feed = feedFile();
  if (!feed) return "";
  // dirname, not a hand-rolled regex. The configured path is a Windows one and
  // arrives with backslashes; a character class that only knew about forward
  // slashes silently returned the whole path including the filename, and the
  // vendor names quietly stayed as codes.
  return join(dirname(feed), "raw files", "Vendor card.xlsx");
}

/**
 * Sheet per feed. Sales has two candidates: the despatch board's OrdersRaw
 * carries 53 columns against Sales_Order_Excel's 6, so it is preferred and
 * BC-FEED is the fallback when only that workbook is configured.
 */
function sheetsFor(key: ServiceKey): SheetRef[] {
  const feed = feedFile();
  const sales = salesFile();
  switch (key) {
    case "productionOrders":
      return [{ file: feed, sheet: "Released_Production_Order_Excel" }];
    case "prodOrderComponents":
      return [{ file: feed, sheet: "Prod_Order_Comp_Lines_Excel" }];
    case "prodOrderRouting":
      return [{ file: feed, sheet: "Prod_Order_Routing_Lines_Excel" }];
    case "outputEvents":
      return [{ file: feed, sheet: "Prod_Order_Data_Entry_Excel" }];
    case "inventory":
      return [{ file: feed, sheet: "Inventory_Summary_Excel" }];
    case "purchaseLines":
      return [{ file: feed, sheet: "Purchase_Order_Line_Excel" }];
    case "items":
      return [{ file: feed, sheet: "Items_card_excel" }];
    case "salesOrders":
      return [
        { file: sales, sheet: "OrdersRaw" },
        { file: feed, sheet: "Sales_Order_Excel" },
      ];
    case "salesLines":
      return [{ file: sales, sheet: "LinesRaw" }];
    case "vendors":
      return [{ file: vendorFile(), sheet: "vendor_card" }];
  }
}

// --- reading ----------------------------------------------------------------
//
// Cached per file and invalidated on the file's modified time, so a scheduled
// refresh is picked up on the next page view without restarting the server.

type Parsed = { at: number; sheets: Map<string, RawRow[]> };
const cache = new Map<string, Parsed>();

/**
 * A cell as the mappers expect it.
 *
 * Two shapes arrive. Most date columns are TEXT, because Power Query brought
 * them straight from the OData JSON ("2026-09-08T22:53:02Z"). Some are real
 * Excel dates, because a query applied a date type - those come back as Date
 * objects thanks to `cellDates`, and become ISO strings here. Numbers stay
 * numbers rather than being read as formatted text, which is what stops a
 * thousands separator turning 14,690 into NaN.
 */
function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function readWorkbook(file: string): Map<string, RawRow[]> {
  const mtime = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.at === mtime) return hit.sheets;

  // Read the bytes here rather than calling XLSX.readFile. The library reaches
  // for `fs` through a dynamic require that Next's bundler strips, so readFile
  // fails with "Cannot access file" even when the path is perfectly valid.
  // Handing it a buffer sidesteps the whole problem.
  const wb = XLSX.read(readFileSync(file), { type: "buffer", cellDates: true });
  const sheets = new Map<string, RawRow[]>();

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { raw: true, defval: "" });
    for (const row of rows) {
      for (const key of Object.keys(row)) row[key] = normalise(row[key]);
    }
    sheets.set(name, rows);
  }

  cache.set(file, { at: mtime, sheets });
  return sheets;
}

/** Is at least one workbook configured and present on disk? */
export function hasWorkbook(): boolean {
  return [feedFile(), salesFile(), vendorFile()].some((f) => f && existsSync(f));
}

export type WorkbookRows = { rows: RawRow[]; refreshedAt: string };

/**
 * Rows for one feed, or null when no configured workbook carries its sheet.
 *
 * Null rather than an empty array on purpose: an empty array is a real answer
 * ("the sheet is there and has no rows"), and the caller has to be able to fall
 * through to the snapshot instead of rendering an empty board.
 */
export function readFeed(key: ServiceKey): WorkbookRows | null {
  for (const ref of sheetsFor(key)) {
    if (!ref.file || !existsSync(ref.file)) continue;

    let rows: RawRow[] | undefined;
    try {
      rows = readWorkbook(ref.file).get(ref.sheet);
    } catch (error) {
      // A workbook open in Excel, half-written by a refresh, or corrupt should
      // not take the board down - fall through to the next candidate, then to
      // the snapshot.
      console.error(`Could not read ${ref.sheet} from ${ref.file}:`, error);
      continue;
    }
    if (!rows) continue;

    return {
      rows: key === "outputEvents" ? withEntryNumbers(rows) : rows,
      refreshedAt: new Date(statSync(ref.file).mtimeMs).toISOString(),
    };
  }
  return null;
}

/**
 * The shop-floor event log needs an entry number.
 *
 * src/lib/floor.ts decides an order's state from the LAST press, breaking ties
 * on entry number - and ties are real, because a Complete can share a timestamp
 * with the QA Book that follows it. The published data-entry page does not
 * expose `Entry No.`, so without this every row would tie at 0 and the winner
 * would be whichever the sort happened to leave last.
 *
 * The sheet preserves the order BC returned, which for an append-only log is
 * entry order, so the row index stands in for it. If the query is ever widened
 * to expose the real `Entry_No`, that wins and this does nothing.
 */
function withEntryNumbers(rows: RawRow[]): RawRow[] {
  if (rows.length === 0 || rows[0].Entry_No !== undefined) return rows;
  return rows.map((row, i) => ({ ...row, Entry_No: i + 1 }));
}
