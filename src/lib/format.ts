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

export function formatNumber(n: number): string {
  return n.toLocaleString("en-GB");
}

/** BC line numbers step in 10000s. Show the human line number. */
export function formatLineNo(lineNo: number): string {
  if (!lineNo) return "";
  return String(lineNo % 10000 === 0 ? lineNo / 10000 : lineNo);
}
