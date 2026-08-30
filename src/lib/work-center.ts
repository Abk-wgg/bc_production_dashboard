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

/** Attaches the work centre and scheduled start date to each order. */
export function withWorkCenters(
  orders: ProductionOrder[],
  lines: ProdOrderRoutingLine[],
): OrderWithWorkCenter[] {
  const centres = buildWorkCenterMap(lines);
  const starts = buildScheduledStartMap(lines);

  return orders.map((order) => ({
    ...order,
    workCenter: centres.get(order.no) ?? "",
    scheduledStart: starts.get(order.no) ?? null,
  }));
}

export type WorkCenterCategory = "production" | "trade" | "unassigned";

/** Centres starting PROD are our own production; anything else is trade. */
export function categorise(workCenter: string): WorkCenterCategory {
  if (!workCenter || workCenter === UNASSIGNED) return "unassigned";
  return workCenter.toUpperCase().startsWith("PROD") ? "production" : "trade";
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
