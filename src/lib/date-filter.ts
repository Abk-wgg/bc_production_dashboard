// The date filter language for the board's date columns.
//
// Typing a date should be typing a date - 300826, the way it gets written on
// paper - not picking through a calendar widget. And the questions people
// actually ask of a schedule are relative ones: this week, last month, anything
// after the end of the month.
//
//   300826            30 August 2026
//   30082026          the same, four-digit year
//   30/08/26          separators are allowed and ignored
//   cw                current week (Monday to Sunday)
//   lm                last month
//   cy | ld | lw ...  c current, l last; d day, w week, m month, y year
//   m                 a bare unit means the current one
//   cd+2              two days from today; the step is in the term's own unit
//   cw-1, cm+3        last week, three months out
//   300826+7          a typed date steps in days
//   +2                a bare step counts from today
//   cd..cd+7          and so, the next seven days
//   >=010826          on or after 1 August
//   <>cm              anything NOT in this month
//   200826..300826    20 to 30 August, inclusive
//   cw|lw             this week or last week
//   >=010826&<cm      August, but before this month started
//
// Everything is case-insensitive and spaces are ignored.
//
// Pure - no BC access, no React, no clock. `asOf` is passed in so the whole
// thing is testable and so the board agrees with itself about what "today" is.

/** An inclusive span of days, as ISO yyyy-mm-dd. */
export type DateRange = { from: string; to: string };

/** Tests one ISO date. A blank date never matches - unknown is not a match. */
export type DateMatcher = (iso: string) => boolean;

const UNITS = ["d", "w", "m", "y"] as const;
type Unit = (typeof UNITS)[number];

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fromISO(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Monday. The week the shop floor works to starts on a Monday. */
function startOfWeek(date: Date): Date {
  const shift = (date.getUTCDay() + 6) % 7;
  return addDays(date, -shift);
}

function periodOf(unit: Unit, offset: number, asOf: string): DateRange {
  const today = fromISO(asOf);

  if (unit === "d") {
    const day = addDays(today, offset);
    return { from: toISO(day), to: toISO(day) };
  }

  if (unit === "w") {
    const monday = addDays(startOfWeek(today), offset * 7);
    return { from: toISO(monday), to: toISO(addDays(monday, 6)) };
  }

  if (unit === "m") {
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth() + offset;
    const first = new Date(Date.UTC(year, month, 1));
    // Day 0 of the next month is the last day of this one, which is how this
    // avoids ever needing to know about February.
    const last = new Date(Date.UTC(year, month + 1, 0));
    return { from: toISO(first), to: toISO(last) };
  }

  const year = today.getUTCFullYear() + offset;
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * A typed date: ddmmyy or ddmmyyyy, with any separators.
 *
 * Two digits of year mean the 2000s. This board's data runs from 2026, and a
 * production order dated 1926 is not a thing anybody is going to type.
 */
function parseTypedDate(token: string): DateRange | null {
  const digits = token.replace(/[^0-9]/g, "");
  if (digits.length !== 6 && digits.length !== 8) return null;

  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = digits.length === 6 ? 2000 + Number(digits.slice(4)) : Number(digits.slice(4));

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31/02 and friends: JS rolls them over, so the round trip differs.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const iso = toISO(date);
  return { from: iso, to: iso };
}

/** `cm`, `mc`, `lw`, `w` - a modifier and a unit, in either order. */
function parseKeyword(token: string): { unit: Unit; offset: number } | null {
  if (token.length === 1) {
    const unit = token as Unit;
    return UNITS.includes(unit) ? { unit, offset: 0 } : null;
  }
  if (token.length !== 2) return null;

  const [a, b] = token;
  const order: [string, string][] = [
    [a, b],
    [b, a],
  ];
  for (const [modifier, unit] of order) {
    if (!UNITS.includes(unit as Unit)) continue;
    if (modifier === "c") return { unit: unit as Unit, offset: 0 };
    if (modifier === "l") return { unit: unit as Unit, offset: -1 };
  }
  return null;
}

/**
 * A term, optionally shifted: `cd+2`, `cw-1`, `300826+7`, or a bare `+2`.
 *
 * The step is in the term's own unit, which is the only reading that does not
 * surprise: `cw+1` is next week, `cm-1` is last month, and a typed date steps in
 * days because a date is a day. A bare `+2` is `cd+2` - if you are counting from
 * nothing, you are counting from today.
 */
function resolveBase(token: string, asOf: string): DateRange | null {
  if (token === "") return null;
  if (/^[0-9]/.test(token)) return parseTypedDate(token);
  const period = parseKeyword(token);
  return period ? periodOf(period.unit, period.offset, asOf) : null;
}

function resolve(token: string, asOf: string): DateRange | null {
  if (token === "") return null;

  // The whole token first, because a hyphenated date is not a subtraction:
  // 30-08-26 has to read as a date before it reads as "30-08 minus 26". Only
  // when the whole thing fails is the trailing +n or -n a step.
  const whole = resolveBase(token, asOf);
  if (whole) return whole;

  const shifted = token.match(/^(.*?)([+-])([0-9]+)$/);
  if (!shifted) return null;
  const [, base, sign, digits] = shifted;
  const step = Number(digits) * (sign === "-" ? -1 : 1);

  // Counting from nothing is counting from today.
  if (base === "") return periodOf("d", step, asOf);

  if (/^[0-9]/.test(base)) {
    const day = parseTypedDate(base);
    if (!day) return null;
    const moved = toISO(addDays(fromISO(day.from), step));
    return { from: moved, to: moved };
  }

  const period = parseKeyword(base);
  return period ? periodOf(period.unit, period.offset + step, asOf) : null;
}

/**
 * One comparison.
 *
 * A term is always a *range*, even when it is a single day, which is what makes
 * the operators behave sensibly against a period: `>cm` is after this month
 * ends, `<cm` is before it began, and `>=cm` is from its first day.
 */
function parseTerm(term: string, asOf: string): DateMatcher | null {
  if (term.includes("..")) {
    const [left, right] = term.split("..");
    const start = resolve(left, asOf);
    const end = resolve(right, asOf);
    if (!start || !end) return null;
    const from = start.from <= end.from ? start.from : end.from;
    const to = start.to >= end.to ? start.to : end.to;
    return (iso) => iso !== "" && iso >= from && iso <= to;
  }

  // Longest first: >= and <= and <> would otherwise be read as > < <.
  const operators = [">=", "<=", "<>", ">", "<", "="] as const;
  const operator = operators.find((op) => term.startsWith(op)) ?? "=";
  const rest = term.startsWith(operator) ? term.slice(operator.length) : term;

  const range = resolve(rest, asOf);
  if (!range) return null;

  switch (operator) {
    case ">":
      return (iso) => iso !== "" && iso > range.to;
    case ">=":
      return (iso) => iso !== "" && iso >= range.from;
    case "<":
      return (iso) => iso !== "" && iso < range.from;
    case "<=":
      return (iso) => iso !== "" && iso <= range.to;
    case "<>":
      return (iso) => iso !== "" && (iso < range.from || iso > range.to);
    default:
      return (iso) => iso !== "" && iso >= range.from && iso <= range.to;
  }
}

/**
 * Compile a filter expression.
 *
 * Returns null when the expression does not parse - including half-typed ones,
 * which is most of them most of the time. The caller should treat that as "no
 * filter yet" rather than "no rows": blanking the table between the third and
 * sixth keystroke of a date helps nobody.
 *
 * `&` binds tighter than `|`, as everywhere else.
 */
export function parseDateFilter(input: string, asOf: string): DateMatcher | null {
  const cleaned = input.toLowerCase().replace(/\s+/g, "");
  if (cleaned === "") return null;

  const alternatives: DateMatcher[] = [];

  for (const group of cleaned.split("|")) {
    const terms: DateMatcher[] = [];
    for (const term of group.split("&")) {
      const matcher = parseTerm(term, asOf);
      if (!matcher) return null;
      terms.push(matcher);
    }
    if (terms.length === 0) return null;
    alternatives.push((iso) => terms.every((match) => match(iso)));
  }

  if (alternatives.length === 0) return null;
  return (iso) => alternatives.some((match) => match(iso));
}

/**
 * The language in six lines, for the tooltip on a date box.
 *
 * Here rather than in a component so the help and the parser cannot drift
 * apart, and so every date filter on the board explains itself the same way.
 */
export const DATE_FILTER_HELP = [
  "300826 or 30082026 - a date",
  "c current, l last + d day, w week, m month, y year: cw, lm, ld, cy",
  "= >= <= > < <> comparisons: >=010826",
  "200826..300826 a range",
  "cd+2, cw-1, 300826+7 - step in the term's own unit; cd..cd+7 next 7 days",
  "| or, & and: cw|lw",
].join("\n");

/** What an empty date box suggests. */
export const DATE_FILTER_PLACEHOLDER = "300826, cw, cd+2\u2026";

/**
 * The common questions, as expressions.
 *
 * Every one is something you could have typed, which is deliberate: the menu
 * fills the box rather than filtering behind it, so choosing one shows you
 * what to type next time. A tooltip is hover-only and nobody hovers a filter
 * box to find out whether it has a language.
 */
export const DATE_PRESETS: readonly { label: string; expr: string }[] = [
  { label: "Today", expr: "cd" },
  { label: "Tomorrow", expr: "cd+1" },
  { label: "Next 7 days", expr: "cd..cd+7" },
  { label: "This week", expr: "cw" },
  { label: "Next week", expr: "cw+1" },
  { label: "This month", expr: "cm" },
  { label: "From today", expr: ">=cd" },
  { label: "Before today", expr: "<cd" },
];
