import type { LibraryItem } from "./library-query";

/*
 * What the library remembers in this tab (sessionStorage) so a trip to a book and back lands on the
 * same row: the extra pages already loaded, the scroll position, and the last library URL.
 * Every function takes the storage so it can be tested, and none of them throws.
 */

export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Extra items kept per snapshot. Past this the list reloads from the server as the person scrolls. */
export const MAX_EXTRA = 500;
/** A snapshot older than this is ignored, so a visit hours later starts at the top. */
export const FEED_TTL_MS = 30 * 60 * 1000;

const FEED_KEY = "mhl.library.feed";
const URL_KEY = "mhl.library.url";
const LEFT_KEY = "mhl.library.left";

export type FeedSnapshot = {
  sig: string;
  extra: LibraryItem[];
  hasMore: boolean;
  scrollY: number;
  /** True once a book link was opened from this list, so the next visit is a return, not a fresh one. */
  bookClick: boolean;
  savedAt: number;
};

/** The storage of this tab, or null when the browser blocks it. */
export function tabStorage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveFeed(store: Store | null, snap: Omit<FeedSnapshot, "savedAt">, now = Date.now()): void {
  if (!store) return;
  const capped = snap.extra.length > MAX_EXTRA;
  const body: FeedSnapshot = {
    ...snap,
    extra: capped ? snap.extra.slice(0, MAX_EXTRA) : snap.extra,
    hasMore: capped ? true : snap.hasMore,
    scrollY: Math.max(0, Math.round(snap.scrollY)),
    savedAt: now,
  };
  try {
    store.setItem(FEED_KEY, JSON.stringify(body));
  } catch {
    // Storage full or blocked: the list just starts from the top next time.
  }
}

/** The snapshot for this exact list (same filters, sort and first page), or null. */
export function loadFeed(store: Store | null, sig: string, now = Date.now()): FeedSnapshot | null {
  if (!store) return null;
  try {
    const raw = store.getItem(FEED_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<FeedSnapshot> | null;
    if (!s || s.sig !== sig || !Array.isArray(s.extra) || typeof s.scrollY !== "number" || typeof s.savedAt !== "number") return null;
    if (now - s.savedAt > FEED_TTL_MS || now < s.savedAt) return null;
    return { sig, extra: s.extra, hasMore: s.hasMore !== false, scrollY: s.scrollY, bookClick: s.bookClick === true, savedAt: s.savedAt };
  } catch {
    return null;
  }
}

/** Remembers the library URL (path and query) for the back link on a book. */
export function saveLibraryUrl(store: Store | null, url: string): void {
  if (!store || !isLibraryUrl(url)) return;
  try {
    store.setItem(URL_KEY, url);
  } catch {
    // Not remembered; the back link falls back to /library.
  }
}

export function loadLibraryUrl(store: Store | null): string | null {
  if (!store) return null;
  try {
    const url = store.getItem(URL_KEY);
    return url && isLibraryUrl(url) ? url : null;
  } catch {
    return null;
  }
}

/** Only an in-app /library path is ever used as a link target. */
export function isLibraryUrl(url: string): boolean {
  return /^\/library(?:[?#].*)?$/.test(url);
}

/** Set when a book is opened from the library: the previous page of this tab is then the library. */
export function markLeftLibrary(store: Store | null, now = Date.now()): void {
  if (!store) return;
  try {
    store.setItem(LEFT_KEY, JSON.stringify({ at: now }));
  } catch {
    // Ignore.
  }
}

export function clearLeftLibrary(store: Store | null): void {
  if (!store) return;
  try {
    store.removeItem(LEFT_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * True when `bookPath` is the first page opened after leaving the library, so going back lands there.
 * The first book to ask claims the flag; a later book (reached from this one) is not "straight from the library".
 */
export function cameFromLibrary(store: Store | null, bookPath: string): boolean {
  if (!store) return false;
  try {
    const raw = store.getItem(LEFT_KEY);
    if (!raw) return false;
    const flag = JSON.parse(raw) as { at?: number; book?: string } | null;
    if (!flag || typeof flag.at !== "number") return false;
    if (!flag.book) {
      store.setItem(LEFT_KEY, JSON.stringify({ ...flag, book: bookPath }));
      return true;
    }
    return flag.book === bookPath;
  } catch {
    return false;
  }
}
