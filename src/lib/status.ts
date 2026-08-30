// BC "Status" option, shared by tables 5405, 5407 and 5410. Pure and
// client-safe - the tables and the schedule all render these labels.

export const STATUS_NAMES = [
  "Simulated",
  "Planned",
  "Firm Planned",
  "Released",
  "Finished",
] as const;

export const RELEASED = 3;
export const FINISHED = 4;

export function statusName(status: number): string {
  return STATUS_NAMES[status] ?? `Status ${status}`;
}

/**
 * Some published pages expose the option CAPTION ("Released") instead of its
 * index, so accept either. Unknown values fall back to Released rather than
 * Simulated: an unrecognised status on a live order is far more likely to be a
 * real, in-progress one than a simulation, and defaulting to 0 would drop the
 * row: Released is the only status the board keeps. See src/lib/scope.ts.
 */
export function toStatus(value: unknown): number {
  const n = Number(value);
  if (Number.isFinite(n) && String(value).trim() !== "") return n;

  const text = String(value ?? "").trim().toLowerCase();
  const index = STATUS_NAMES.findIndex((name) => name.toLowerCase() === text);
  return index === -1 ? RELEASED : index;
}
