// Weeks, as the shop floor counts them: Monday to Sunday.
//
// The schedule pages through days because that is the unit work runs in.
// Purchasing does not - a delivery lands on a day but is planned in a week,
// and "what do I owe this supplier next week" is the question a buyer asks.
// So this page groups the same lines into weeks.
//
// Monday-start, matching the `cw` / `lw` terms in the date language and the
// week the floor works to. ISO week numbering, so "w36" means the same thing
// here as it does on anyone else's calendar.
//
// Pure - no BC access, no React, no clock.

/** Midnight UTC on an ISO date. */
function fromISO(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * The Monday of the week an ISO date falls in.
 *
 * Returns "" for a blank date rather than guessing - an undated line belongs in
 * no week, and putting it in this one would overstate the week's load.
 */
export function mondayOf(iso: string): string {
  if (!iso) return "";
  const date = fromISO(iso);
  if (Number.isNaN(date.getTime())) return "";
  // getUTCDay is 0 for Sunday, so shift the week to start on Monday.
  return toISO(addDays(date, -((date.getUTCDay() + 6) % 7)));
}

/** The Sunday that closes a week, given its Monday. */
export function sundayOf(monday: string): string {
  if (!monday) return "";
  return toISO(addDays(fromISO(monday), 6));
}

/**
 * The ISO 8601 week number.
 *
 * The rule is "the week containing the year's first Thursday is week 1", which
 * is why this jumps to the Thursday of the week before counting: it puts the
 * turn of the year on the right side without a table of special cases. Late
 * December can therefore read w01 and early January w52, which is correct and
 * is exactly what a paper wall planner shows.
 */
export function weekNumber(iso: string): number {
  const monday = mondayOf(iso);
  if (!monday) return 0;
  const thursday = addDays(fromISO(monday), 3);
  const firstOfYear = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const days = Math.round((thursday.getTime() - firstOfYear.getTime()) / 86_400_000);
  return Math.floor(days / 7) + 1;
}

/** "w36" - the short form, for a column that has to stay narrow. */
export function weekLabel(iso: string): string {
  const week = weekNumber(iso);
  return week === 0 ? "" : `w${String(week).padStart(2, "0")}`;
}

/**
 * Whether a week has already finished, relative to a given day.
 *
 * A week is only past once its Sunday has gone. The week you are standing in
 * is not late, however far through it you are.
 */
export function isPastWeek(monday: string, asOf: string): boolean {
  if (!monday || !asOf) return false;
  return sundayOf(monday) < asOf;
}

/**
 * Which week the page should open on: the one you are standing in, or the next
 * one that has work.
 *
 * Same reasoning as the schedule's landing day, one unit up. Not the earliest
 * week in the data - on real data that is a single stalled June order, week 1
 * of 11, with the week anyone actually came to look at eight clicks away.
 * Previous still walks back through the whole backlog; this just starts you
 * where "what do I owe this week" is answered.
 *
 * A week counts as current until its Sunday has gone, so mid-week you land on
 * the week you are in rather than being pushed forward into the next one.
 * If every week is in the past, open on the most recent - the same choice the
 * schedule makes. Undated rows are never a landing place.
 */
export function initialWeekIndex(weeks: string[], asOf: string): number {
  let lastDated = -1;

  for (let i = 0; i < weeks.length; i++) {
    if (!weeks[i]) continue;
    if (!isPastWeek(weeks[i], asOf)) return i;
    lastDated = i;
  }

  return lastDated === -1 ? 0 : lastDated;
}

/** Every day in a week, Monday first. */
export function daysOf(monday: string): string[] {
  if (!monday) return [];
  const start = fromISO(monday);
  return Array.from({ length: 7 }, (_, i) => toISO(addDays(start, i)));
}

/**
 * The weeks a date expression picks out.
 *
 * A week matches when ANY of its days does, not when its Monday does. Typing
 * a single date has to find the week containing it, and someone typing
 * 300826 - a Sunday - means "the week I am in", not "no weeks". The same rule
 * makes `cm` return every week that touches the month, including the two that
 * straddle its ends.
 *
 * The undated bucket never matches, because a blank date matches nothing. A
 * date filter is a question about when, and "no date" is not an answer to it.
 */
export function weeksMatching(weeks: string[], match: (iso: string) => boolean): string[] {
  return weeks.filter((week) => week !== "" && daysOf(week).some(match));
}

/**
 * The span a set of weeks covers: the first Monday to the last Sunday.
 *
 * Whole weeks, not the days the filter happened to name. Someone who asked for
 * "this month" is being shown six whole weeks, and reporting the range as
 * 1-31 August would describe a narrower period than what is on screen.
 */
export function weekSpan(weeks: string[]): { from: string; to: string } | null {
  const dated = weeks.filter(Boolean).sort();
  if (dated.length === 0) return null;
  return { from: dated[0], to: sundayOf(dated[dated.length - 1]) };
}
