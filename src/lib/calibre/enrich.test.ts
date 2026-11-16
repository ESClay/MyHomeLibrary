import { describe, expect, it, vi } from "vitest";
import { findMetadata, gapFill, type CalibreBook } from "./enrich";
import type { BookMetadata } from "@/lib/metadata/types";

const meta = (over: Partial<BookMetadata> = {}): BookMetadata => ({
  title: "The Fellowship of the Ring",
  subtitle: null,
  authors: ["J. R. R. Tolkien"],
  seriesName: "The Lord of the Rings",
  seriesPosition: 1,
  description: "From the provider",
  covers: [{ url: "https://img.example/cover.jpg", source: "hardcover" }],
  pageCount: 423,
  publishedDate: "1954",
  genres: ["Fantasy", "Adventure"],
  isbn13: "9780261102354",
  isbn10: null,
  ids: { hardcover: 99, google: "g1", openLibrary: "/works/OL1W" },
  rating: { value: 4.4, count: 1000, source: "hardcover" },
  providers: ["hardcover"],
  ...over,
});

const book = (over: Partial<CalibreBook> = {}): CalibreBook => ({
  title: "The Fellowship of the Ring",
  authors: ["J. R. R. Tolkien"],
  series: null,
  seriesPosition: null,
  isbn13: "9780261102354",
  ...over,
});

describe("gapFill never overwrites what Calibre has", () => {
  it("fills series, cover, pages, genres, rating and ids when Calibre left them empty", () => {
    const g = gapFill(book(), meta());
    expect(g).toMatchObject({
      series_name: "The Lord of the Rings",
      series_position: 1,
      cover_url: "https://img.example/cover.jpg",
      page_count: 423,
      genres: ["Fantasy", "Adventure"],
      public_rating: 4.4,
      public_rating_count: 1000,
      rating_source: "hardcover",
      hardcover_id: 99,
    });
  });

  it("keeps Calibre's series and position even when the provider disagrees", () => {
    const g = gapFill(book({ series: "My Own Series", seriesPosition: 3 }), meta({ seriesName: "Other", seriesPosition: 9 }));
    expect(g).not.toHaveProperty("series_name");
    expect(g).not.toHaveProperty("series_position");
  });

  it("fills only the position when the series name matches and Calibre had none", () => {
    const g = gapFill(book({ series: "lord of the rings", seriesPosition: null }), meta({ seriesName: "The Lord of the Rings", seriesPosition: 1 }));
    expect(g.series_position).toBe(1);
    expect(g).not.toHaveProperty("series_name");
    const other = gapFill(book({ series: "Something else", seriesPosition: null }), meta());
    expect(other).not.toHaveProperty("series_position");
  });

  it("ignores insecure cover links and returns nothing without metadata", () => {
    expect(gapFill(book(), meta({ covers: [{ url: "http://x.example/c.jpg", source: "google" }] }))).not.toHaveProperty("cover_url");
    expect(gapFill(book(), null)).toEqual({});
  });
});

describe("findMetadata (lookups are mocked)", () => {
  const never = () => false;
  const free = async () => true;

  it("looks up by ISBN first and accepts an agreeing record", async () => {
    const lookups = { lookupByIsbn: vi.fn().mockResolvedValue(meta()), search: vi.fn() };
    const r = await findMetadata(book(), lookups, free, never);
    expect(r).toMatchObject({ kind: "found", via: "isbn" });
    expect(lookups.search).not.toHaveBeenCalled();
  });

  it("rejects an ISBN hit that is a different book, then searches by title and first author", async () => {
    const lookups = {
      lookupByIsbn: vi.fn().mockResolvedValue(meta({ title: "Cooking With Gas", authors: ["Someone Else"] })),
      search: vi.fn().mockResolvedValue([meta()]),
    };
    const r = await findMetadata(book(), lookups, free, never);
    expect(r).toMatchObject({ kind: "found", via: "search" });
    expect(lookups.search).toHaveBeenCalledWith("The Fellowship of the Ring J. R. R. Tolkien");
  });

  it("searches directly when there is no ISBN, and reports none for a poor match", async () => {
    const lookups = { lookupByIsbn: vi.fn(), search: vi.fn().mockResolvedValue([meta({ title: "Totally Different", authors: ["Zed"] })]) };
    const r = await findMetadata(book({ isbn13: null }), lookups, free, never);
    expect(lookups.lookupByIsbn).not.toHaveBeenCalled();
    expect(r.kind).toBe("none");
  });

  it("skips the lookup when the batch has no slot left", async () => {
    const lookups = { lookupByIsbn: vi.fn(), search: vi.fn() };
    const r = await findMetadata(book(), lookups, async () => false, never);
    expect(r.kind).toBe("skipped");
    expect(lookups.lookupByIsbn).not.toHaveBeenCalled();
  });

  it("stops and reports a rate limit", async () => {
    const lookups = { lookupByIsbn: vi.fn().mockResolvedValue(null), search: vi.fn() };
    const r = await findMetadata(book(), lookups, free, () => true);
    expect(r.kind).toBe("rate-limited");
    expect(lookups.search).not.toHaveBeenCalled();
  });

  it("a lookup that throws is not an error", async () => {
    const lookups = { lookupByIsbn: vi.fn().mockRejectedValue(new Error("boom")), search: vi.fn().mockRejectedValue(new Error("boom")) };
    expect((await findMetadata(book(), lookups, free, never)).kind).toBe("none");
  });
});
