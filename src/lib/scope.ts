// What the board is FOR.
//
// Two rules decide which rows exist at all. They live here, in one place,
// because they are applied in the data layer - every page, the schedule and the
// JSON feeds all inherit them, so nothing can quietly disagree about what
// "a production order" means.
//
// Pure functions, no BC access.

import { RELEASED } from "./status";

/**
 * Only orders made at our own PRODUCTION location. The other location, TRADE,
 * is bought-in and labelling work - real orders, but not what this board is
 * about, and they outnumber production roughly fifteen to one.
 */
export const BOARD_LOCATION = "PRODUCTION";

export function isBoardLocation(locationCode: string): boolean {
  return locationCode.trim().toUpperCase() === BOARD_LOCATION;
}

/**
 * Released is the only status the board carries. It is what the shop floor
 * works to: Simulated, Planned and Firm Planned are not real work yet, and
 * Finished is over.
 *
 * This was three copies of a "Released only" toggle - one per table, each
 * defaulted on and, as far as anyone could tell, never turned off. Three
 * components owning a rule between them is how they come to disagree, and the
 * JSON feeds had no copy at all, so Excel and Power BI saw a wider board than
 * the screen did. One rule, applied once, in the data layer.
 */
export const BOARD_STATUS = RELEASED;

export function isBoardStatus(status: number): boolean {
  return status === BOARD_STATUS;
}

/**
 * BC "Flushing Method" on a component line: how the material gets consumed.
 *
 * - Manual - somebody books it out deliberately
 * - Forward / Backward - BC consumes it automatically on start or finish
 * - Pick + Forward / Pick + Backward - warehouse picks it, then BC consumes it
 *
 * Only manually flushed lines need a human to do anything, so they are the only
 * ones worth putting on a board someone works from. The rest are noise.
 */
export const FLUSHING_METHODS = [
  "Manual",
  "Forward",
  "Backward",
  "Pick + Forward",
  "Pick + Backward",
] as const;

export const MANUAL = 0;

export function flushingMethodName(method: number): string {
  return FLUSHING_METHODS[method] ?? `Method ${method}`;
}

/**
 * Accepts the option index or its caption - which one a published web service
 * sends varies by page, exactly as it does for Status.
 *
 * An unrecognised value is treated as Manual rather than dropped: hiding a
 * component line because we could not read its flushing method would silently
 * remove real work from the board, which is the worse failure.
 */
export function toFlushingMethod(value: unknown): number {
  const n = Number(value);
  if (Number.isFinite(n) && String(value).trim() !== "") return n;

  const text = String(value ?? "").trim().toLowerCase();
  const index = FLUSHING_METHODS.findIndex((name) => name.toLowerCase() === text);
  return index === -1 ? MANUAL : index;
}

export function isManuallyFlushed(method: number): boolean {
  return method === MANUAL;
}


/**
 * Shop-floor `Event Type` values the board reads (table 50403).
 *
 * Consumption events are deliberately not used: they record material going in,
 * which is a different question from what came out, and their scrap quantity
 * would double-count against the Scrap events.
 */
export const OUTPUT_EVENT_TYPE = "Output";
export const SCRAP_EVENT_TYPE = "Scrap";
