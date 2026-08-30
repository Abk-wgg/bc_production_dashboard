// What the shop floor is doing right now, from the button presses.
//
// BC has no "is this order running" field. The only record of it is the event
// log on table 50403: an operator presses Start, Pause, Restart, Complete or
// QA Book, and each press lands as a row. The order's state is therefore the
// LAST press, and nothing else.
//
// This reproduces the Floor column on the picking control board, which is the
// screen the shop floor already reads. It agrees with that board on 979 of the
// 982 open orders; the three that differ have a blank timestamp in the picking
// board's own export, so it had no last event to read.
//
// Pure - no BC access, no credentials.

import type { FloorState, FloorStatus, OutputEvent } from "./types";

export type { FloorState, FloorStatus };

export const NOT_ON_THE_LINE: FloorState = { status: "not-started", operator: "", at: null };

/**
 * Button press to state.
 *
 * `Complete` is its own state, not Running. Most of the time it is the end of
 * production: the batch is off the line and waiting on QA. On a large order the
 * floor completes and QA-books several times over, so a Complete is not proof
 * the order is done - but it is proof that nothing is being made right now,
 * which is what Running is supposed to mean.
 *
 * It used to fold into Running, and the fold was hiding most of that tile: 33
 * of the 41 orders reading Running had Complete as their last press, a median
 * of four days earlier. Only 8 had actually been started or restarted.
 *
 * Finishing the order is BC's business, not this file's. Output posts at the
 * QA Book, and BC finishes the order there once posted output passes 96% of
 * the order quantity.
 */
const BY_BUTTON: Record<string, FloorStatus> = {
  Start: "running",
  Restart: "running",
  Complete: "complete",
  Pause: "paused",
  "QA Book": "qa-booked",
};

export function floorStatusOf(buttonEvent: string): FloorStatus {
  // A button we do not recognise still means somebody pressed something on this
  // order, so it cannot be "not started". Showing it as running is the smaller
  // error: it puts the order in front of a person rather than hiding it.
  return BY_BUTTON[buttonEvent] ?? "running";
}

export const FLOOR_STATES: {
  key: FloorStatus;
  label: string;
  /** Pill style, matching the picking control board's colours. */
  tone: "run" | "done" | "pause" | "qa" | null;
}[] = [
  // In the order work moves through them, which is also the order the tiles
  // are drawn in: started, made, stopped, booked, untouched.
  { key: "running", label: "Running", tone: "run" },
  { key: "complete", label: "Complete", tone: "done" },
  { key: "paused", label: "Paused", tone: "pause" },
  { key: "qa-booked", label: "QA booked", tone: "qa" },
  { key: "not-started", label: "Not started", tone: null },
];

export function floorLabel(status: FloorStatus): string {
  return FLOOR_STATES.find((s) => s.key === status)?.label ?? status;
}

export function floorTone(status: FloorStatus): string {
  return FLOOR_STATES.find((s) => s.key === status)?.tone ?? "";
}

/** Anything but untouched: started, complete, paused or waiting on QA. */
export function isOnTheLine(status: FloorStatus): boolean {
  return status !== "not-started";
}

/**
 * The last press per production order.
 *
 * Ties are broken on entry number. Presses land milliseconds apart and a
 * Complete can share a timestamp with the QA Book that follows it, so ordering
 * on the timestamp alone would pick whichever the feed happened to return
 * first - and the two say opposite things about the line.
 */
export function buildFloorMap(events: OutputEvent[]): Map<string, FloorState> {
  const latest = new Map<string, OutputEvent>();

  for (const event of events) {
    if (!event.prodOrderNo) continue;
    const held = latest.get(event.prodOrderNo);
    if (!held || isLater(event, held)) latest.set(event.prodOrderNo, event);
  }

  const states = new Map<string, FloorState>();
  for (const [orderNo, event] of latest) {
    states.set(orderNo, {
      status: floorStatusOf(event.buttonEvent),
      operator: event.lineLeader,
      at: event.at || null,
    });
  }
  return states;
}

function isLater(a: OutputEvent, b: OutputEvent): boolean {
  if (a.at !== b.at) return a.at > b.at;
  return a.entryNo > b.entryNo;
}

/** How many orders sit in each state, in the order the board displays them. */
export function countFloorStates(
  orderNos: string[],
  states: Map<string, FloorState>,
): Record<FloorStatus, number> {
  const counts: Record<FloorStatus, number> = {
    running: 0,
    complete: 0,
    paused: 0,
    "qa-booked": 0,
    "not-started": 0,
  };
  // Counted over the orders on the board, not over the event log: an event for
  // an order this board does not show must not appear in the totals.
  for (const no of orderNos) counts[(states.get(no) ?? NOT_ON_THE_LINE).status] += 1;
  return counts;
}
