/**
 * Gap positions. Rows keep integer positions 1024 apart, so putting a row between two others rewrites
 * only that row. When two neighbours have no integer between them the whole list is renormalized.
 * Used for shelf_books.position (a manual shelf's own order) and shelves.sort_order (the row order).
 */
export const GAP = 1024;
const LIMIT = 2_000_000_000;

export type Positioned = { id: string; pos: number };

/** A position strictly between `before` and `after` (either may be absent), or null when none fits. */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return GAP;
  if (before === null) {
    const p = (after as number) - GAP;
    return p > -LIMIT ? p : null;
  }
  if (after === null) {
    const p = before + GAP;
    return p < LIMIT ? p : null;
  }
  const mid = Math.floor((before + after) / 2);
  return mid > before && mid < after ? mid : null;
}

/** Positions 1024, 2048, ... for a list already in the wanted order. */
export function renormalize(ids: string[]): Positioned[] {
  return ids.map((id, i) => ({ id, pos: (i + 1) * GAP }));
}

/** Sorted copy: by position, then id, so equal positions are stable. */
export function sortByPosition<T extends Positioned>(list: T[]): T[] {
  return [...list].sort((a, b) => a.pos - b.pos || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type MovePlan = {
  /** Rows whose position must be written. One row, or every row after a renormalize. */
  updates: Positioned[];
  renormalized: boolean;
  /** The ids in their new order. */
  order: string[];
};

/**
 * Moves `id` so it ends up at index `toIndex` of the list (clamped). `list` is in its current order.
 * Returns the writes needed. A move to the same place writes nothing.
 */
export function planMove(list: Positioned[], id: string, toIndex: number): MovePlan {
  const sorted = sortByPosition(list);
  const from = sorted.findIndex((p) => p.id === id);
  if (from === -1) return { updates: [], renormalized: false, order: sorted.map((p) => p.id) };
  const rest = sorted.filter((p) => p.id !== id);
  const to = Math.max(0, Math.min(rest.length, Math.trunc(toIndex)));
  const order = [...rest.slice(0, to).map((p) => p.id), id, ...rest.slice(to).map((p) => p.id)];
  if (to === from) return { updates: [], renormalized: false, order };

  const before = to > 0 ? rest[to - 1].pos : null;
  const after = to < rest.length ? rest[to].pos : null;
  const pos = positionBetween(before, after);
  if (pos === null) return { updates: renormalize(order), renormalized: true, order };
  return { updates: [{ id, pos }], renormalized: false, order };
}

/** The position for a new row appended after the current last one. */
export function appendPosition(list: Positioned[]): number {
  const max = list.reduce((m, p) => Math.max(m, p.pos), 0);
  return positionBetween(max, null) ?? max + 1;
}

/** Positions for several rows appended in order. */
export function appendPositions(list: Positioned[], ids: string[]): Positioned[] {
  let last = list.reduce((m, p) => Math.max(m, p.pos), 0);
  return ids.map((id) => {
    last = last + GAP;
    return { id, pos: last };
  });
}

/**
 * Turns "the list should now read `desired`" into the fewest writes. A single moved row (what a drag or an
 * up/down press makes) is one write; anything else renormalizes the lot. Ids missing from `desired` stay last.
 */
export function planReorder(list: Positioned[], desired: string[]): MovePlan {
  const current = sortByPosition(list);
  const currentIds = current.map((p) => p.id);
  const known = new Set(currentIds);
  const wanted = [...new Set(desired.filter((id) => known.has(id)))];
  for (const id of currentIds) if (!wanted.includes(id)) wanted.push(id);
  if (wanted.every((id, i) => id === currentIds[i])) return { updates: [], renormalized: false, order: wanted };

  for (const id of wanted) {
    const a = currentIds.filter((x) => x !== id);
    const b = wanted.filter((x) => x !== id);
    if (a.every((x, i) => x === b[i])) return planMove(current, id, wanted.indexOf(id));
  }
  return { updates: renormalize(wanted), renormalized: true, order: wanted };
}
