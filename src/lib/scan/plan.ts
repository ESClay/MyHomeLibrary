/** Turns the tray plus the bulk settings into what "Save all" will do. Pure. */
import type { Condition, Format, Ownership } from "@/lib/books/constants";
import type { ItemAction, TrayItem } from "@/lib/scan/tray";

export type BulkSettings = { ownership: Ownership; format: Format; condition: Condition | "" };
export const DEFAULT_BULK: BulkSettings = { ownership: "owned", format: "paperback", condition: "" };

export type Resolved = {
  id: string;
  action: ItemAction;
  ownership: Ownership;
  format: Format;
  condition: Condition | "";
  /** The existing book when the action is "copy". */
  targetBookId: string | null;
  /** Why an item is skipped, for the review screen. */
  reason: string | null;
};

export const hasManualTitle = (i: TrayItem) => (i.overrides.title ?? "").trim() !== "";

/** The action an item gets when the person has not chosen: in-library books skip, unknown books stay out until edited. */
export function defaultAction(i: TrayItem): ItemAction {
  if (i.duplicates && i.duplicates.length > 0) return "skip";
  if (i.status === "found") return "add";
  if (i.status === "notfound" && hasManualTitle(i)) return "add";
  return "skip";
}

/** Whether an action is possible for this item at all. */
export function allowedActions(i: TrayItem, ownership: Ownership): ItemAction[] {
  const isDup = !!i.duplicates && i.duplicates.length > 0;
  if (isDup) return ownership === "owned" ? ["skip", "copy"] : ["skip"];
  if (i.status === "found" || (i.status === "notfound" && hasManualTitle(i))) return ["skip", "add"];
  return ["skip"];
}

export function resolveItem(i: TrayItem, bulk: BulkSettings): Resolved {
  const ownership = i.overrides.ownership ?? bulk.ownership;
  const format = i.overrides.format ?? bulk.format;
  const condition = i.overrides.condition ?? bulk.condition;
  const wanted = i.overrides.action ?? defaultAction(i);
  const action = allowedActions(i, ownership).includes(wanted) ? wanted : "skip";

  let reason: string | null = null;
  if (action === "skip") {
    if (i.status === "pending") reason = "Still looking this one up";
    else if (i.status === "error") reason = "The lookup failed";
    else if (i.duplicates && i.duplicates.length > 0) reason = "Already in your library";
    else if (i.status === "notfound" && !hasManualTitle(i)) reason = "Not found: add a title to include it";
    else reason = "Skipped";
  }
  return {
    id: i.id,
    action,
    ownership,
    format,
    condition,
    targetBookId: action === "copy" ? (i.duplicates?.[0]?.id ?? null) : null,
    reason,
  };
}

export function summarize(items: TrayItem[], bulk: BulkSettings) {
  const resolved = items.map((i) => resolveItem(i, bulk));
  return {
    resolved,
    toAdd: resolved.filter((r) => r.action === "add").length,
    toCopy: resolved.filter((r) => r.action === "copy").length,
    skipped: resolved.filter((r) => r.action === "skip").length,
  };
}
