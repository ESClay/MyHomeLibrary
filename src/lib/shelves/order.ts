/** Move one item of a list; the pure core of every reorder in the app. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const clamped = Math.max(0, Math.min(list.length - 1, to));
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}

export type OrderAction =
  | { type: "move"; id: string; to: number }
  | { type: "up"; id: string }
  | { type: "down"; id: string }
  | { type: "reset"; ids: string[] };

/** Reducer for a list of ids shown as rows (the shelves page) or books (a custom-ordered shelf). */
export function orderReducer(state: string[], action: OrderAction): string[] {
  if (action.type === "reset") return action.ids;
  const from = state.indexOf(action.id);
  if (from === -1) return state;
  const to = action.type === "move" ? action.to : action.type === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= state.length || to === from) return state;
  return moveItem(state, from, to);
}
