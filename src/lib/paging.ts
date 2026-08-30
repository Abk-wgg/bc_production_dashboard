// Which page numbers a pager shows.
//
// Pure - no React, no DOM.

/** A gap in the run of page numbers, drawn as an ellipsis. */
export const GAP = null;

/**
 * The page buttons to draw, as zero-based indexes with `GAP` where the run
 * breaks.
 *
 * Always the first page, always the last, and always the current one with
 * `span` neighbours either side. Twenty buttons in a row is a wall nobody
 * reads; three is a lie about how long the list is. This shows where you are
 * and how far there is to go, in about seven.
 *
 * The window keeps a steady width as you move through the middle, so the
 * buttons do not shuffle sideways under the pointer between clicks.
 */
export function pageWindow(current: number, count: number, span = 1): (number | null)[] {
  if (count <= 0) return [];

  const wanted = new Set<number>([0, count - 1]);
  for (let page = current - span; page <= current + span; page++) {
    if (page >= 0 && page < count) wanted.add(page);
  }

  const pages = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let previous = -1;

  for (const page of pages) {
    // A gap of exactly one is not worth an ellipsis - it takes the same room as
    // the number it hides, and the number is more use.
    if (previous !== -1 && page - previous === 2) out.push(previous + 1);
    else if (previous !== -1 && page - previous > 2) out.push(GAP);
    out.push(page);
    previous = page;
  }

  return out;
}
