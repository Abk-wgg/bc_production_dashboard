// Where an order's work centre comes from.
//
// Table 5405 does not carry a work centre. Each routing line (5409) ties one
// operation to a centre, so an order's centre is derived from its lines.
//
// Pure functions - no BC access.

import type { OrderWithWorkCenter, ProductionOrder, ProdOrderRoutingLine } from "./types";

/**
 * PRINTING runs on almost every order, so including it would put nearly the
 * whole board in one column and tell nobody anything. It is excluded from the
 * derived work centre.
 */
export const EXCLUDED_WORK_CENTER = "PRINTING";

/** Shown in place of a code when an order has no usable routing line. */
export const UNASSIGNED = "— No work center —";

/**
 * Prod. Order No. -> work centre code(s). An order with more than one
 * non-printing centre gets them joined with ", ".
 */
export function buildWorkCenterMap(lines: ProdOrderRoutingLine[]): Map<string, string> {
  const byOrder = new Map<string, Set<string>>();

  for (const line of lines) {
    const order = line.prodOrderNo;
    // `no` is the centre this operation actually runs on; `workCenterNo` is set
    // too when the operation is on a machine centre inside a work centre.
    const centre = line.no;
    if (!order || !centre) continue;

    const isPrinting =
      centre.toUpperCase() === EXCLUDED_WORK_CENTER ||
      line.workCenterNo.toUpperCase() === EXCLUDED_WORK_CENTER;
    if (isPrinting) continue;

    if (!byOrder.has(order)) byOrder.set(order, new Set());
    byOrder.get(order)!.add(centre);
  }

  const map = new Map<string, string>();
  for (const [order, centres] of byOrder) {
    map.set(order, [...centres].sort().join(", "));
  }
  return map;
}

/**
 * Prod. Order No. -> earliest routing-line Starting Date.
 *
 * This is when the work is planned to run. The order header carries a due date,
 * which is when it is owed - a different question, and the wrong one to build a
 * schedule around.
 *
 * PRINTING is skipped here for the same reason it is skipped above: an order
 * whose only operation is printing has no work centre, so it has no place on
 * the board either, and should not be given a start date that implies it does.
 */
export function buildScheduledStartMap(
  lines: ProdOrderRoutingLine[],
): Map<string, string> {
  const earliest = new Map<string, string>();

  for (const line of lines) {
    const order = line.prodOrderNo;
    const centre = line.no;
    if (!order || !centre || !line.startingDate) continue;

    const isPrinting =
      centre.toUpperCase() === EXCLUDED_WORK_CENTER ||
      line.workCenterNo.toUpperCase() === EXCLUDED_WORK_CENTER;
    if (isPrinting) continue;

    const current = earliest.get(order);
    // ISO dates compare correctly as plain strings.
    if (!current || line.startingDate < current) earliest.set(order, line.startingDate);
  }

  return earliest;
}

/**
 * Prod. Order No. -> the routing the order actually runs on.
 *
 * The 5405 header carries a `Routing No.` too, and it is not to be trusted: it
 * reads ERROR_ROUTE on 669 of 982 released orders, where the routing LINES for
 * those same orders read ERROR_ROUTE on only 26. Showing the header value put a
 * broken-looking routing against two-thirds of the board and overstated a real
 * but small data problem by roughly thirty times.
 *
 * PRINTING is NOT skipped here, unlike the two maps above. Those answer "where
 * and when does this run", which printing would distort; this answers "which
 * routing is this order on", and every line of an order shares that answer.
 */
export function buildRoutingNoMap(lines: ProdOrderRoutingLine[]): Map<string, string> {
  const byOrder = new Map<string, Set<string>>();

  for (const line of lines) {
    if (!line.prodOrderNo || !line.routingNo) continue;
    if (!byOrder.has(line.prodOrderNo)) byOrder.set(line.prodOrderNo, new Set());
    byOrder.get(line.prodOrderNo)!.add(line.routingNo);
  }

  const map = new Map<string, string>();
  for (const [order, routings] of byOrder) {
    map.set(order, [...routings].sort().join(", "));
  }
  return map;
}

/** Attaches the work centre, scheduled start date and true routing to each order. */
export function withWorkCenters(
  orders: ProductionOrder[],
  lines: ProdOrderRoutingLine[],
): OrderWithWorkCenter[] {
  const centres = buildWorkCenterMap(lines);
  const starts = buildScheduledStartMap(lines);
  const routings = buildRoutingNoMap(lines);

  return orders.map((order) => ({
    ...order,
    workCenter: centres.get(order.no) ?? "",
    scheduledStart: starts.get(order.no) ?? null,
    // Fall back to the header only when the order has no routing line at all -
    // a wrong-looking value beats a blank one, and it is 2 orders in 982.
    routingNo: routings.get(order.no) || order.routingNo,
  }));
}

export type WorkCenterCategory = "production" | "trade" | "unassigned";

/**
 * Ours, despite not being named PROD-anything.
 *
 * `UNPLANNED` is our own production — work not yet assigned to a line, not work
 * sent out. Judging it on the name filed 236 orders, a quarter of the board,
 * under Trade, where anyone filtering to Production would never see them.
 */
const PRODUCTION_CENTERS = new Set(["UNPLANNED"]);

/** Centres we send work out to rather than run ourselves. */
const TRADE_CENTERS = new Set(["OUTSIDE-LINE"]);

/**
 * In-house or sent out?
 *
 * The PROD- prefix is a naming convention, not a rule, so the two sets above
 * are the source of truth and the prefix is only a fallback for a centre
 * neither knows about. **A new work centre needs adding to one of them** —
 * otherwise it lands in whichever bucket its name happens to suggest, which is
 * exactly how UNPLANNED ended up on the wrong side.
 */
export function categorise(workCenter: string): WorkCenterCategory {
  if (!workCenter || workCenter === UNASSIGNED) return "unassigned";

  const code = workCenter.toUpperCase();
  if (PRODUCTION_CENTERS.has(code)) return "production";
  if (TRADE_CENTERS.has(code)) return "trade";

  return code.startsWith("PROD") ? "production" : "trade";
}

/** An order can span centres, so split before categorising. */
export function splitWorkCenters(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True if the order has at least one centre of that category. */
export function orderHasCategory(
  workCenter: string,
  category: Exclude<WorkCenterCategory, "unassigned">,
): boolean {
  return splitWorkCenters(workCenter).some((wc) => categorise(wc) === category);
}
