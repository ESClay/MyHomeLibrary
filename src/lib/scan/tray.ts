/** The scan tray: state, reducer and localStorage round trip. Pure; storage is passed in. */
import { CONDITIONS, FORMATS, OWNERSHIPS, type Condition, type Format, type Ownership } from "@/lib/books/constants";
import { isIsbn13 } from "@/lib/isbn";
import type { BookMetadata } from "@/lib/metadata/types";

export const TRAY_LIMIT = 200;
export const STORAGE_PREFIX = "mhl.scan-tray.v1:";
export const trayKey = (libraryId: string) => `${STORAGE_PREFIX}${libraryId}`;

export type LookupStatus = "pending" | "found" | "notfound" | "error";
export type ItemAction = "add" | "copy" | "skip";

/** A book already on the shelves that the scanned ISBN matches (same shape the add flow uses). */
export type TrayDuplicate = { id: string; title: string; authors: string[]; reason: "isbn" | "title" };

/** Per-book choices. Anything unset follows the bulk settings. */
export type ItemOverrides = {
  ownership?: Ownership;
  format?: Format;
  /** "" means "not set" and is a real choice, distinct from following the bulk value. */
  condition?: Condition | "";
  action?: ItemAction;
  /** Typed in for a book the lookup could not find. */
  title?: string;
  authors?: string;
};

export type TrayItem = {
  id: string;
  isbn: string;
  addedAt: number;
  status: LookupStatus;
  meta: BookMetadata | null;
  /** null until checked against the library; never persisted (the library may change). */
  duplicates: TrayDuplicate[] | null;
  overrides: ItemOverrides;
};

export type TrayAction =
  | { type: "restore"; items: TrayItem[] }
  | { type: "add"; id: string; isbn: string; now: number }
  | { type: "found"; id: string; meta: BookMetadata }
  | { type: "notfound"; id: string }
  | { type: "failed"; id: string }
  | { type: "retry"; id: string }
  | { type: "duplicates"; id: string; duplicates: TrayDuplicate[] }
  | { type: "override"; id: string; patch: ItemOverrides }
  | { type: "remove"; ids: string[] }
  | { type: "clear" };

const update = (items: TrayItem[], id: string, fn: (i: TrayItem) => TrayItem) =>
  items.map((i) => (i.id === id ? fn(i) : i));

export function trayReducer(items: TrayItem[], action: TrayAction): TrayItem[] {
  switch (action.type) {
    case "restore":
      return action.items;
    case "add":
      // One entry per ISBN; the newest scan goes first so it is the one in view.
      if (items.some((i) => i.isbn === action.isbn) || items.length >= TRAY_LIMIT) return items;
      return [
        { id: action.id, isbn: action.isbn, addedAt: action.now, status: "pending", meta: null, duplicates: null, overrides: {} },
        ...items,
      ];
    case "found":
      return update(items, action.id, (i) => ({ ...i, status: "found", meta: action.meta }));
    case "notfound":
      return update(items, action.id, (i) => ({ ...i, status: "notfound", meta: null }));
    case "failed":
      return update(items, action.id, (i) => ({ ...i, status: "error" }));
    case "retry":
      return update(items, action.id, (i) => ({ ...i, status: "pending", duplicates: null }));
    case "duplicates":
      return update(items, action.id, (i) => ({ ...i, duplicates: action.duplicates }));
    case "override":
      return update(items, action.id, (i) => ({ ...i, overrides: { ...i.overrides, ...action.patch } }));
    case "remove": {
      const gone = new Set(action.ids);
      return items.filter((i) => !gone.has(i.id));
    }
    case "clear":
      return [];
  }
}

/** What background work an item still needs. */
export function pendingWork(i: TrayItem): "lookup" | "dupcheck" | null {
  if (i.status === "pending") return "lookup";
  if ((i.status === "found" || i.status === "notfound") && i.duplicates === null) return "dupcheck";
  return null;
}

// ------------------------------------------------------------ persistence

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Lookups in flight, errors and duplicates are not stored: they are redone after a reload. */
export function serializeTray(items: TrayItem[]): string {
  const slim = items.map((i) => ({
    id: i.id,
    isbn: i.isbn,
    addedAt: i.addedAt,
    status: i.status === "found" ? "found" : "pending",
    meta: i.status === "found" ? i.meta : null,
    overrides: i.overrides,
  }));
  return JSON.stringify({ v: 1, items: slim });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function cleanOverrides(raw: unknown): ItemOverrides {
  if (!isObj(raw)) return {};
  const o: ItemOverrides = {};
  if (OWNERSHIPS.includes(raw.ownership as Ownership)) o.ownership = raw.ownership as Ownership;
  if (FORMATS.includes(raw.format as Format)) o.format = raw.format as Format;
  if (raw.condition === "" || CONDITIONS.includes(raw.condition as Condition)) o.condition = raw.condition as Condition | "";
  if (raw.action === "add" || raw.action === "copy" || raw.action === "skip") o.action = raw.action;
  if (typeof raw.title === "string") o.title = raw.title.slice(0, 300);
  if (typeof raw.authors === "string") o.authors = raw.authors.slice(0, 400);
  return o;
}

function validMeta(m: unknown): m is BookMetadata {
  return (
    isObj(m) &&
    typeof m.title === "string" &&
    m.title !== "" &&
    isStrArr(m.authors) &&
    Array.isArray(m.covers) &&
    isStrArr(m.genres) &&
    isObj(m.ids) &&
    Array.isArray(m.providers)
  );
}

/** Parse stored text defensively. Anything malformed is dropped; a bad payload yields an empty tray. */
export function parseTray(raw: string | null): TrayItem[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isObj(data) || data.v !== 1 || !Array.isArray(data.items)) return [];
  const out: TrayItem[] = [];
  const seen = new Set<string>();
  for (const r of data.items) {
    if (!isObj(r)) continue;
    const { id, isbn, addedAt } = r;
    if (typeof id !== "string" || id === "" || typeof isbn !== "string" || !isIsbn13(isbn)) continue;
    if (seen.has(isbn)) continue;
    seen.add(isbn);
    const found = r.status === "found" && validMeta(r.meta);
    out.push({
      id,
      isbn,
      addedAt: typeof addedAt === "number" && Number.isFinite(addedAt) ? addedAt : 0,
      status: found ? "found" : "pending",
      meta: found ? (r.meta as BookMetadata) : null,
      duplicates: null,
      overrides: cleanOverrides(r.overrides),
    });
    if (out.length >= TRAY_LIMIT) break;
  }
  return out;
}

export function loadTray(storage: StorageLike | null, libraryId: string): TrayItem[] {
  try {
    return parseTray(storage ? storage.getItem(trayKey(libraryId)) : null);
  } catch {
    return [];
  }
}

/** Returns false when the write failed (private mode, quota, blocked storage). */
export function saveTray(storage: StorageLike | null, libraryId: string, items: TrayItem[]): boolean {
  if (!storage) return false;
  try {
    if (items.length === 0) storage.removeItem(trayKey(libraryId));
    else storage.setItem(trayKey(libraryId), serializeTray(items));
    return true;
  } catch {
    return false;
  }
}
