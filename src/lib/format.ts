// Display formatting. Pure and client-safe.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "2026-06-24" -> "24 Jun 2026". Formatted from the string parts rather than a
 * Date so it renders identically on the server and in the browser - a Date
 * would be interpreted in whatever timezone each end is set to and could shift
 * the day, which React then flags as a hydration mismatch.
 */
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month) return iso;
  return `${Number(d)} ${month} ${y}`;
}

/** Weekday and date for the schedule heading, e.g. "Wed 24 Jun 2026". */
export function formatDayHeading(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  return `${day} ${formatDate(iso)}`;
}

/**
 * "2026-08-28T06:20:12.66Z" -> "28 Aug 06:20".
 *
 * Rendered from the UTC parts, not through a Date. A Date would be shown in
 * whatever timezone each end is set to, which shifts the clock by an hour in
 * British Summer Time and makes the server and the browser disagree - a
 * hydration mismatch. The picking control board shows the UTC time too, so the
 * two screens read the same.
 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const [date, rest] = iso.split("T");
  if (!rest) return formatDate(date);
  const [y, m, d] = date.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month) return iso;
  return `${Number(d)} ${month} ${rest.slice(0, 5)}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-GB");
}

/** BC line numbers step in 10000s. Show the human line number. */
export function formatLineNo(lineNo: number): string {
  if (!lineNo) return "";
  return String(lineNo % 10000 === 0 ? lineNo / 10000 : lineNo);
}

/**
 * A week as its span, e.g. "31 Aug - 6 Sep 2026".
 *
 * The year is written once, and the month only when the week crosses one, so
 * the heading stays a date range rather than becoming two full dates joined by
 * a dash. A week inside one month reads "3 - 9 Aug 2026".
 */
export function formatWeekRange(monday: string, sunday: string): string {
  if (!monday || !sunday) return "";
  const [, m1, d1] = monday.split("-");
  const [y2, m2, d2] = sunday.split("-");
  const month1 = MONTHS[Number(m1) - 1];
  const month2 = MONTHS[Number(m2) - 1];
  if (!month1 || !month2) return `${formatDate(monday)} - ${formatDate(sunday)}`;
  const from = m1 === m2 ? `${Number(d1)}` : `${Number(d1)} ${month1}`;
  return `${from} - ${Number(d2)} ${month2} ${y2}`;
}

/**
 * A quantity at a glance: 621,073 EACH -> "621k", 12,681.926 KG -> "12.68 t".
 *
 * For SUMMARY figures only. A vendor's weekly total is a magnitude - nobody
 * orders 621,073 of something in one line - so rounding it costs nothing and
 * makes a column of six-digit numbers comparable at a glance. The item
 * quantities in the panel are the ones transcribed onto a purchase order and
 * stay exact, as do the Excel export and the JSON feed, so nothing that gets
 * acted on or reconciled against BC is ever a rounded figure.
 *
 * Kilos become tonnes because that is how a tonne is talked about; everything
 * else keeps its own unit and takes a k/M suffix, because "621k bottles" is a
 * count and there is no larger unit of bottle.
 *
 * Precision shrinks as the number grows, so every value reads at about three
 * significant figures: 13.9k, 108k, 1.25M. Two weeks that differ enough to
 * matter never round to the same string.
 */
export function compactQuantity(quantity: number, unit: string): string {
  const sign = quantity < 0 ? "-" : "";
  const value = Math.abs(quantity);

  // Below a thousand there is nothing to shorten, and the exact figure is
  // more use than a decimal of it.
  if (value < 1000) return `${sign}${formatNumber(quantity)} (${unit})`;

  if (/^kgs?$/i.test(unit.trim())) {
    const tonnes = value / 1000;
    return `${sign}${trim(tonnes, tonnes < 100 ? 2 : tonnes < 1000 ? 1 : 0)} t`;
  }

  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${sign}${trim(millions, millions < 10 ? 2 : 1)}M (${unit})`;
  }

  const thousands = value / 1000;
  return `${sign}${trim(thousands, thousands < 100 ? 1 : 0)}k (${unit})`;
}

/** Fixed decimals with trailing zeros dropped - 12.50 reads better as 12.5. */
function trim(value: number, places: number): string {
  const fixed = value.toFixed(places);
  return places === 0 ? fixed : fixed.replace(/\.?0+$/, "");
}

/** How much of one filter value the file name will carry. */
const NAME_PART = 28;
/** How many filters it will name before giving up and saying "filtered". */
const NAME_PARTS = 2;

/**
 * The export's file name, carrying whatever narrowed it.
 *
 * A workbook filtered to one supplier and called `vendors-2026-08-24.xlsx` is
 * awkward to send on - the recipient cannot tell from the name what is inside,
 * and two of them in a downloads folder are indistinguishable. Naming the
 * filter makes the download the thing you were going to send.
 *
 * Only the values, not the column they came from: a vendor name says what it
 * is, and "Vendor-Advance-Flavour-Solutions" only says it twice. Past two
 * filters it stops listing and says `filtered`, because a file name that
 * needs scrolling is no more use than one that says nothing.
 *
 * Everything outside A-Z, 0-9 becomes a hyphen - Windows rejects half of
 * punctuation in a file name, and a vendor called "Sone Products Ltd." would
 * otherwise ship a full stop into the middle of one.
 */
export function exportFileName(base: string, filters: string[], on: string): string {
  const slugs = filters
    .map((value) =>
      value
        .trim()
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, NAME_PART)
        .replace(/-+$/, ""),
    )
    .filter((slug) => slug !== "");

  const middle =
    slugs.length === 0 ? "" : slugs.length > NAME_PARTS ? "-filtered" : `-${slugs.join("-")}`;

  return `${base}${middle}-${on}.xlsx`;
}
