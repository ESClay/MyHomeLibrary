import { describe, expect, it } from "vitest";
import {
  FEED_TTL_MS,
  MAX_EXTRA,
  cameFromLibrary,
  clearLeftLibrary,
  loadFeed,
  loadLibraryUrl,
  markLeftLibrary,
  saveFeed,
  saveLibraryUrl,
  type Store,
} from "./library-memory";
import type { LibraryItem } from "./library-query";

function memory(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
const broken: Store = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};
const item = (n: number) => ({ id: `b${n}` }) as unknown as LibraryItem;
const snap = (extra: LibraryItem[], over = {}) => ({ sig: "s1", extra, hasMore: false, scrollY: 1234.6, bookClick: true, ...over });

describe("library feed memory", () => {
  it("round-trips a snapshot for the same sig", () => {
    const s = memory();
    saveFeed(s, snap([item(1), item(2)]), 1000);
    const got = loadFeed(s, "s1", 2000);
    expect(got?.extra).toHaveLength(2);
    expect(got?.scrollY).toBe(1235);
    expect(got?.bookClick).toBe(true);
  });

  it("ignores a different sig, an expired snapshot and junk", () => {
    const s = memory();
    saveFeed(s, snap([item(1)]), 1000);
    expect(loadFeed(s, "other", 2000)).toBeNull();
    expect(loadFeed(s, "s1", 1000 + FEED_TTL_MS + 1)).toBeNull();
    s.setItem("mhl.library.feed", "{nope");
    expect(loadFeed(s, "s1", 2000)).toBeNull();
  });

  it("caps the extra items and says there is more", () => {
    const s = memory();
    saveFeed(s, snap(Array.from({ length: MAX_EXTRA + 40 }, (_, i) => item(i))), 1000);
    const got = loadFeed(s, "s1", 1001);
    expect(got?.extra).toHaveLength(MAX_EXTRA);
    expect(got?.hasMore).toBe(true);
  });

  it("never throws without storage", () => {
    expect(() => saveFeed(broken, snap([]))).not.toThrow();
    expect(loadFeed(broken, "s1")).toBeNull();
    expect(loadFeed(null, "s1")).toBeNull();
    expect(() => saveLibraryUrl(broken, "/library?q=a")).not.toThrow();
    expect(loadLibraryUrl(broken)).toBeNull();
    expect(cameFromLibrary(broken, "/books/1")).toBe(false);
  });
});

describe("library url memory", () => {
  it("keeps only library paths", () => {
    const s = memory();
    saveLibraryUrl(s, "https://evil.example/library");
    expect(loadLibraryUrl(s)).toBeNull();
    saveLibraryUrl(s, "/library?sort=author&dir=asc");
    expect(loadLibraryUrl(s)).toBe("/library?sort=author&dir=asc");
    saveLibraryUrl(s, "/library");
    expect(loadLibraryUrl(s)).toBe("/library");
  });
});

describe("came-from-library flag", () => {
  it("is false until a book is opened from the library", () => {
    expect(cameFromLibrary(memory(), "/books/a")).toBe(false);
  });

  it("belongs to the first book page only", () => {
    const s = memory();
    markLeftLibrary(s);
    expect(cameFromLibrary(s, "/books/a")).toBe(true);
    expect(cameFromLibrary(s, "/books/a")).toBe(true); // Strict-mode double mount.
    expect(cameFromLibrary(s, "/books/b")).toBe(false); // Reached from book a.
  });

  it("is cleared when the library is shown again", () => {
    const s = memory();
    markLeftLibrary(s);
    clearLeftLibrary(s);
    expect(cameFromLibrary(s, "/books/a")).toBe(false);
  });
});
