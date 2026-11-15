import { describe, expect, it } from "vitest";
import type { BookMetadata } from "@/lib/metadata/types";
import { loadTray, parseTray, saveTray, serializeTray, trayKey, trayReducer, pendingWork, type TrayItem } from "./tray";

const meta = (title = "Dune"): BookMetadata => ({
  title,
  subtitle: null,
  authors: ["Frank Herbert"],
  seriesName: null,
  seriesPosition: null,
  description: null,
  covers: [{ url: "https://example.com/c.jpg", source: "google" }],
  pageCount: null,
  publishedDate: null,
  genres: [],
  isbn13: "9780441172719",
  isbn10: null,
  ids: {},
  rating: null,
  providers: ["google"],
});

const add = (items: TrayItem[], id: string, isbn: string, now = 1) => trayReducer(items, { type: "add", id, isbn, now });
const DUNE = "9780441172719";
const HOBBIT = "9780547928227";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  };
}

describe("trayReducer", () => {
  it("adds newest first as pending", () => {
    let s = add([], "1", DUNE);
    s = add(s, "2", HOBBIT);
    expect(s.map((i) => i.id)).toEqual(["2", "1"]);
    expect(s[0]).toMatchObject({ status: "pending", meta: null, duplicates: null, overrides: {} });
  });
  it("keeps one entry per ISBN", () => {
    const s = add(add([], "1", DUNE), "2", DUNE);
    expect(s).toHaveLength(1);
    expect(s[0].id).toBe("1");
  });
  it("moves an item through found / notfound / failed / retry", () => {
    let s = add([], "1", DUNE);
    s = trayReducer(s, { type: "found", id: "1", meta: meta() });
    expect(s[0]).toMatchObject({ status: "found", meta: { title: "Dune" } });
    s = trayReducer(s, { type: "failed", id: "1" });
    expect(s[0].status).toBe("error");
    s = trayReducer(s, { type: "retry", id: "1" });
    expect(s[0]).toMatchObject({ status: "pending", duplicates: null });
    s = trayReducer(s, { type: "notfound", id: "1" });
    expect(s[0]).toMatchObject({ status: "notfound", meta: null });
  });
  it("merges overrides and records duplicates", () => {
    let s = add([], "1", DUNE);
    s = trayReducer(s, { type: "override", id: "1", patch: { format: "ebook" } });
    s = trayReducer(s, { type: "override", id: "1", patch: { action: "skip" } });
    expect(s[0].overrides).toEqual({ format: "ebook", action: "skip" });
    s = trayReducer(s, { type: "duplicates", id: "1", duplicates: [{ id: "b", title: "Dune", authors: [], reason: "isbn" }] });
    expect(s[0].duplicates).toHaveLength(1);
  });
  it("removes by id and clears", () => {
    let s = add(add([], "1", DUNE), "2", HOBBIT);
    s = trayReducer(s, { type: "remove", ids: ["1"] });
    expect(s.map((i) => i.id)).toEqual(["2"]);
    expect(trayReducer(s, { type: "clear" })).toEqual([]);
  });
  it("reports the background work an item needs", () => {
    let s = add([], "1", DUNE);
    expect(pendingWork(s[0])).toBe("lookup");
    s = trayReducer(s, { type: "found", id: "1", meta: meta() });
    expect(pendingWork(s[0])).toBe("dupcheck");
    s = trayReducer(s, { type: "duplicates", id: "1", duplicates: [] });
    expect(pendingWork(s[0])).toBeNull();
  });
});

describe("persistence", () => {
  it("round-trips found items and overrides, and sends everything else back to pending", () => {
    let s = add([], "1", DUNE);
    s = add(s, "2", HOBBIT);
    s = trayReducer(s, { type: "found", id: "1", meta: meta() });
    s = trayReducer(s, { type: "override", id: "1", patch: { format: "hardcover", condition: "good" } });
    s = trayReducer(s, { type: "duplicates", id: "1", duplicates: [{ id: "b", title: "Dune", authors: [], reason: "isbn" }] });
    s = trayReducer(s, { type: "notfound", id: "2" });
    const back = parseTray(serializeTray(s));
    expect(back).toHaveLength(2);
    const dune = back.find((i) => i.id === "1")!;
    expect(dune).toMatchObject({ status: "found", meta: { title: "Dune" }, duplicates: null, overrides: { format: "hardcover", condition: "good" } });
    expect(back.find((i) => i.id === "2")).toMatchObject({ status: "pending", meta: null });
  });
  it("saves and restores through storage under a per-library key", () => {
    const st = memoryStorage();
    const s = add([], "1", DUNE);
    expect(saveTray(st, "lib-a", s)).toBe(true);
    expect(Object.keys(st.data)).toEqual([trayKey("lib-a")]);
    expect(loadTray(st, "lib-a")).toHaveLength(1);
    expect(loadTray(st, "lib-b")).toEqual([]);
    saveTray(st, "lib-a", []);
    expect(st.data).toEqual({});
  });
  it("survives broken or hostile storage data", () => {
    expect(parseTray(null)).toEqual([]);
    expect(parseTray("not json")).toEqual([]);
    expect(parseTray("42")).toEqual([]);
    expect(parseTray(JSON.stringify({ v: 2, items: [] }))).toEqual([]);
    expect(parseTray(JSON.stringify({ v: 1, items: "no" }))).toEqual([]);
    const messy = JSON.stringify({
      v: 1,
      items: [
        null,
        { id: "x", isbn: "123" }, // not an ISBN
        { id: "y", isbn: "9780441172718" }, // bad checksum
        { id: "", isbn: DUNE },
        { id: "ok", isbn: DUNE, status: "found", meta: { title: 5 }, overrides: { format: "vinyl", condition: "mint", action: "fly", title: 3 } },
        { id: "dup", isbn: DUNE },
      ],
    });
    const out = parseTray(messy);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "ok", status: "pending", meta: null, overrides: {} });
  });
  it("does not throw when storage throws or is unavailable", () => {
    const boom = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadTray(boom, "l")).toEqual([]);
    expect(saveTray(boom, "l", add([], "1", DUNE))).toBe(false);
    expect(loadTray(null, "l")).toEqual([]);
    expect(saveTray(null, "l", [])).toBe(false);
  });
});
