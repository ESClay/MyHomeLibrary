import { describe, expect, it } from "vitest";
import type { BookMetadata } from "@/lib/metadata/types";
import { allowedActions, DEFAULT_BULK, defaultAction, resolveItem, summarize, type BulkSettings } from "./plan";
import type { TrayItem } from "./tray";

const meta = { title: "Dune", authors: ["Frank Herbert"], covers: [], genres: [], ids: {}, providers: [] } as unknown as BookMetadata;
const item = (over: Partial<TrayItem> = {}): TrayItem => ({
  id: "1",
  isbn: "9780441172719",
  addedAt: 0,
  status: "found",
  meta,
  duplicates: [],
  overrides: {},
  ...over,
});
const dup = [{ id: "book-1", title: "Dune", authors: [], reason: "isbn" as const }];
const bulk: BulkSettings = { ownership: "owned", format: "hardcover", condition: "good" };

describe("bulk vs per-item settings", () => {
  it("follows the bulk settings when nothing is overridden", () => {
    expect(resolveItem(item(), bulk)).toMatchObject({ action: "add", ownership: "owned", format: "hardcover", condition: "good" });
  });
  it("lets each book override any one setting", () => {
    const r = resolveItem(item({ overrides: { format: "ebook", ownership: "wishlist" } }), bulk);
    expect(r).toMatchObject({ format: "ebook", ownership: "wishlist", condition: "good" });
  });
  it("treats an explicit empty condition as 'not set', not as 'follow bulk'", () => {
    expect(resolveItem(item({ overrides: { condition: "" } }), bulk).condition).toBe("");
  });
  it("changing the bulk value changes every book that has no override", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b", overrides: { format: "ebook" } });
    const out = summarize([a, b], { ...bulk, format: "paperback" }).resolved;
    expect(out.map((r) => r.format)).toEqual(["paperback", "ebook"]);
  });
});

describe("duplicates default to skip", () => {
  it("skips an in-library book", () => {
    const i = item({ duplicates: dup });
    expect(defaultAction(i)).toBe("skip");
    expect(resolveItem(i, DEFAULT_BULK)).toMatchObject({ action: "skip", reason: "Already in your library" });
  });
  it("adds a copy to the existing book when asked", () => {
    const r = resolveItem(item({ duplicates: dup, overrides: { action: "copy" } }), bulk);
    expect(r).toMatchObject({ action: "copy", targetBookId: "book-1" });
  });
  it("cannot add a copy of a wishlist book, or add the duplicate as new", () => {
    expect(resolveItem(item({ duplicates: dup, overrides: { action: "copy", ownership: "wishlist" } }), bulk).action).toBe("skip");
    expect(resolveItem(item({ duplicates: dup, overrides: { action: "add" } }), bulk).action).toBe("skip");
    expect(allowedActions(item({ duplicates: dup }), "owned")).toEqual(["skip", "copy"]);
  });
});

describe("books the lookup could not use", () => {
  it("leaves 'not found' out until a title is typed", () => {
    const nf = item({ status: "notfound", meta: null });
    expect(resolveItem(nf, bulk)).toMatchObject({ action: "skip" });
    expect(resolveItem({ ...nf, overrides: { title: "  " } }, bulk).action).toBe("skip");
    expect(resolveItem({ ...nf, overrides: { title: "My Book" } }, bulk).action).toBe("add");
  });
  it("skips items still looking up or failed, whatever the override says", () => {
    expect(resolveItem(item({ status: "pending", meta: null, overrides: { action: "add" } }), bulk).action).toBe("skip");
    expect(resolveItem(item({ status: "error", meta: null }), bulk).reason).toBe("The lookup failed");
  });
  it("counts what will happen", () => {
    const s = summarize(
      [item({ id: "a" }), item({ id: "b", duplicates: dup }), item({ id: "c", duplicates: dup, overrides: { action: "copy" } }), item({ id: "d", status: "notfound", meta: null })],
      bulk,
    );
    expect([s.toAdd, s.toCopy, s.skipped]).toEqual([1, 1, 2]);
  });
});
