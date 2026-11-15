import { describe, expect, it } from "vitest";
import { addReadSchema, bookFieldsSchema, copySchema, createBookSchema, myBookSchema } from "./schemas";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

describe("bookFieldsSchema", () => {
  it("normalizes empties to null and trims", () => {
    const r = bookFieldsSchema.parse({ title: "  Dune ", subtitle: "", authors: ["Frank Herbert"], pageCount: "412", seriesPosition: "", isbn13: "", ownership: "owned" });
    expect(r).toMatchObject({ title: "Dune", subtitle: null, pageCount: 412, seriesPosition: null, isbn13: null });
  });
  it("rejects a missing title, bad ISBN and non-https covers", () => {
    expect(bookFieldsSchema.safeParse({ title: " ", ownership: "owned" }).success).toBe(false);
    expect(bookFieldsSchema.safeParse({ title: "x", isbn13: "123", ownership: "owned" }).success).toBe(false);
    expect(bookFieldsSchema.safeParse({ title: "x", coverUrl: "http://x.test/a.jpg", ownership: "owned" }).success).toBe(false);
    expect(bookFieldsSchema.safeParse({ title: "x", coverUrl: "https://x.test/a.jpg", ownership: "owned" }).success).toBe(true);
  });
});

describe("copySchema", () => {
  it("parses price strings and rejects negatives", () => {
    expect(copySchema.parse({ format: "ebook", purchasePrice: "12.50", purchaseDate: "2026-02-03" })).toMatchObject({ purchasePrice: 12.5, purchaseDate: "2026-02-03", condition: null });
    expect(copySchema.safeParse({ format: "ebook", purchasePrice: "-1" }).success).toBe(false);
    expect(copySchema.safeParse({ format: "vinyl" }).success).toBe(false);
    expect(copySchema.safeParse({ format: "ebook", purchaseDate: "2026-13-45" }).success).toBe(false);
  });
});

describe("myBookSchema", () => {
  it("accepts half-star ratings only", () => {
    expect(myBookSchema.safeParse({ bookId: uuid, rating: 3.5 }).success).toBe(true);
    expect(myBookSchema.safeParse({ bookId: uuid, rating: 3.3 }).success).toBe(false);
    expect(myBookSchema.safeParse({ bookId: uuid, rating: 0 }).success).toBe(false);
    expect(myBookSchema.safeParse({ bookId: uuid, rating: 5.5 }).success).toBe(false);
    expect(myBookSchema.safeParse({ bookId: uuid, rating: null }).success).toBe(true);
  });
});

describe("addReadSchema", () => {
  it("needs a date and a sensible order", () => {
    expect(addReadSchema.safeParse({ bookId: uuid, read: { startedAt: "", finishedAt: "" } }).success).toBe(false);
    expect(addReadSchema.safeParse({ bookId: uuid, read: { startedAt: "2026-03-02", finishedAt: "2026-03-01" } }).success).toBe(false);
    expect(addReadSchema.safeParse({ bookId: uuid, read: { startedAt: "2026-03-01", finishedAt: "" } }).success).toBe(true);
  });
});

describe("createBookSchema", () => {
  it("accepts a minimal payload", () => {
    const r = createBookSchema.safeParse({ libraryId: uuid, book: { title: "Dune", ownership: "wishlist" }, provider: {} });
    expect(r.success).toBe(true);
  });
});
