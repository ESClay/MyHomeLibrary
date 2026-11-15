import { describe, expect, it } from "vitest";
import googleIsbn from "./__fixtures__/google-isbn.json";
import hardcoverIsbn from "./__fixtures__/hardcover-isbn.json";
import hardcoverSearch from "./__fixtures__/hardcover-search.json";
import olIsbn from "./__fixtures__/openlibrary-isbn.json";
import olSearch from "./__fixtures__/openlibrary-search.json";
import { normalizeGoogleResponse } from "./googleBooks";
import { hardcoverHits, normalizeHardcoverDocument, normalizeHardcoverEdition } from "./hardcover";
import { coverKey, mergeMetadata, mergeSearchResults } from "./merge";
import { normalizeOpenLibraryBook, normalizeOpenLibraryDoc } from "./openLibrary";
import { emptyMetadata } from "./util";
import type { BookMetadata } from "./types";

const hc = normalizeHardcoverEdition(hardcoverIsbn.data.editions[0])!;
const gb = normalizeGoogleResponse(googleIsbn)[0];
const ol = normalizeOpenLibraryBook(Object.values(olIsbn)[0])!;

describe("hardcover normalization", () => {
  it("maps an edition lookup", () => {
    expect(hc.title).toBe("Dune");
    expect(hc.authors).toEqual(["Frank Herbert"]); // illustrator dropped
    expect(hc.seriesName).toBe("Dune");
    expect(hc.seriesPosition).toBe(1);
    expect(hc.isbn13).toBe("9780441172719");
    expect(hc.isbn10).toBe("0441172717");
    expect(hc.pageCount).toBe(612);
    expect(hc.genres).toEqual(["Science Fiction", "Fantasy"]);
    expect(hc.rating).toEqual({ value: 4.31, count: 126481, source: "hardcover" });
    expect(hc.ids.hardcover).toBe(312460);
    expect(hc.description).toBe("Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides.");
    expect(hc.covers.map((c) => c.url)).toHaveLength(2);
  });
  it("maps search documents and treats a zero rating as none", () => {
    const docs = hardcoverHits(hardcoverSearch.data.search.results)
      .map(normalizeHardcoverDocument)
      .filter((m): m is BookMetadata => m !== null);
    expect(docs).toHaveLength(2);
    expect(docs[0].isbn13).toBe("9780441172719");
    expect(docs[0].seriesName).toBe("Dune");
    expect(docs[1].rating).toBeNull();
    expect(docs[1].seriesPosition).toBe(2);
    expect(docs[1].covers).toEqual([]);
  });
  it("returns null for malformed input", () => {
    expect(normalizeHardcoverEdition(null)).toBeNull();
    expect(normalizeHardcoverEdition({ book: {} })).toBeNull();
    expect(hardcoverHits({})).toEqual([]);
  });
});

describe("google books normalization", () => {
  it("maps a volume", () => {
    expect(gb.title).toBe("Dune");
    expect(gb.subtitle).toBe("Deluxe Edition");
    expect(gb.isbn13).toBe("9780441172719");
    expect(gb.isbn10).toBe("0441172717");
    expect(gb.pageCount).toBe(535);
    expect(gb.genres).toEqual(["Fiction", "Science Fiction", "Action & Adventure", "Fantasy"]);
    expect(gb.rating?.source).toBe("google");
    expect(gb.seriesName).toBeNull();
  });
  it("sanitizes the description and upgrades covers to https", () => {
    expect(gb.description).toBe("Set on the desert planet Arrakis, Dune is the story of Paul Atreides & his family.\n\nA masterpiece.\nTruly.");
    expect(gb.covers[0].url.startsWith("https://")).toBe(true);
    expect(gb.covers[0].url).not.toContain("edge=curl");
  });
  it("handles empty responses", () => {
    expect(normalizeGoogleResponse({ totalItems: 0 })).toEqual([]);
  });
});

describe("open library normalization", () => {
  it("maps a books-API record", () => {
    expect(ol.title).toBe("Dune");
    expect(ol.authors).toEqual(["Frank Herbert"]);
    expect(ol.isbn13).toBe("9780441172719");
    expect(ol.pageCount).toBe(896);
    expect(ol.ids.openLibrary).toBe("OL59726263M");
    expect(ol.covers.length).toBeGreaterThan(0);
  });
  it("maps search docs", () => {
    const docs = olSearch.docs.map(normalizeOpenLibraryDoc).filter((m): m is BookMetadata => m !== null);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0].title).toBe("Dune");
    expect(docs[0].covers[0].url).toContain("covers.openlibrary.org/b/id/");
    expect(docs[0].rating?.source).toBe("openlibrary");
    expect(docs[0].isbn13).toMatch(/^97[89]\d{10}$/);
  });
});

describe("merge", () => {
  const merged = mergeMetadata([ol, gb, hc])!; // order must not matter

  it("lets Hardcover win series and rating", () => {
    expect(merged.seriesName).toBe("Dune");
    expect(merged.seriesPosition).toBe(1);
    expect(merged.rating?.source).toBe("hardcover");
  });
  it("fills gaps from other providers", () => {
    expect(merged.subtitle).toBe("Deluxe Edition"); // Hardcover has none, Google does
    expect(merged.providers).toEqual(["hardcover", "google", "openlibrary"]);
    expect(merged.ids).toMatchObject({ hardcover: 312460, google: "B1hSG45JCX4C", openLibrary: "OL59726263M" });
  });
  it("takes scalar fields from the highest-priority provider", () => {
    expect(merged.pageCount).toBe(612);
    expect(merged.description).toContain("Arrakis");
  });
  it("unions covers without duplicates and unions genres", () => {
    const urls = merged.covers.map((c) => c.url);
    expect(new Set(urls.map(coverKey)).size).toBe(urls.length);
    expect(merged.covers.map((c) => c.source)).toEqual(expect.arrayContaining(["hardcover", "google", "openlibrary"]));
    expect(merged.genres).toEqual(expect.arrayContaining(["Science Fiction", "Fantasy", "Fiction"]));
  });
  it("dedupes covers that differ only by size or query string", () => {
    const a = { ...emptyMetadata("hardcover"), title: "X", covers: [{ url: "https://covers.openlibrary.org/b/id/1-L.jpg", source: "hardcover" as const }] };
    const b = { ...emptyMetadata("openlibrary"), title: "X", covers: [{ url: "https://covers.openlibrary.org/b/id/1-M.jpg", source: "openlibrary" as const }] };
    expect(mergeMetadata([a, b])!.covers).toHaveLength(1);
  });
  it("derives ISBN-13 from ISBN-10 when only that is known", () => {
    const only10 = { ...emptyMetadata("google"), title: "X", isbn10: "0441172717" };
    expect(mergeMetadata([only10])!.isbn13).toBe("9780441172719");
  });
  it("strips HTML from descriptions", () => {
    const m = { ...emptyMetadata("google"), title: "X", description: "<p>Hi <i>there</i></p>" };
    expect(mergeMetadata([m])!.description).toBe("Hi there");
  });
  it("returns null for no input", () => {
    expect(mergeMetadata([])).toBeNull();
  });
});

describe("mergeSearchResults", () => {
  it("merges the same book across providers and keeps different ones apart", () => {
    const hcDocs = hardcoverHits(hardcoverSearch.data.search.results)
      .map(normalizeHardcoverDocument)
      .filter((m): m is BookMetadata => m !== null);
    const results = mergeSearchResults([hcDocs, [gb], [ol]]);
    expect(results.map((r) => r.title)).toEqual(["Dune", "Dune Messiah"]);
    expect(results[0].providers).toEqual(["hardcover", "google", "openlibrary"]);
  });
  it("joins a title-only record to an ISBN record by title and author", () => {
    const a = { ...emptyMetadata("hardcover"), title: "The Hobbit", authors: ["J.R.R. Tolkien"], isbn13: "9780261102217" };
    const b = { ...emptyMetadata("openlibrary"), title: "Hobbit", authors: ["Tolkien, J.R.R."] };
    expect(mergeSearchResults([[a], [b]])).toHaveLength(1);
  });
});
