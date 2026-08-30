// Field mapping helpers shared by every BC source.
//
// Publishing a page as a web service RENAMES its fields: spaces become
// underscores and full stops are dropped, so "Sales Order No." arrives as
// "Sales_Order_No". Exactly which spelling you get depends on the page and the
// BC version, so we try the likely ones rather than hard-coding a single name
// and quietly rendering a column of blanks.
//
// Pure functions, no BC access - safe to unit test and to import anywhere.

/** A row exactly as BC sent it, before any field mapping. */
export type RawRow = Record<string, unknown>;

export function pick(row: RawRow, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

export function toText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

export function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** BC sends "0001-01-01" for an empty date field. Return null for those. */
export function toDate(value: unknown): string | null {
  const text = toText(value);
  if (!text || text.startsWith("0001-01-01")) return null;
  return text.slice(0, 10);
}

export function toBool(value: unknown): boolean {
  const text = toText(value).toLowerCase();
  return text === "true" || text === "yes" || text === "1";
}
