import { describe, expect, it } from "vitest";
import type { BookMetadata } from "@/lib/metadata/types";
import {
  SuggestionCache,
  announce,
  escapeLike,
  likePatterns,
  mergeSuggestions,
  normalizeQuery,
  shouldSuggest,
  type LibrarySuggestion,
} from "./typeahead";

const lib = (o: Partial<LibrarySuggestion> & { id: string }): LibrarySuggestion => ({
  title: "Dune",
  authors: ["Frank Herbert"],
  seriesName: null,
  seriesPosition: null,
  coverUrl: null,
  isbn13: null,
  ...o,
});

const online = (o: Partial<BookMetadata>): BookMetadata => ({
  title: "Dune",
  subtitle: null,
  authors: ["Frank Herbert"],
  seriesName: null,
  seriesPosition: null,
  description: null,
  covers: [],
  pageCount: null,
  publishedDate: null,
  genres: [],
  isbn13: null,
  isbn10: null,
  ids: {},
  rating: null,
  providers: ["google"],
  ...o,
});

describe("query gating", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeQuery("  The   Name  of THE Wind ")).toBe("the name of the wind");
  });
  it("requires 3 characters after trimming", () => {
    expect(shouldSuggest("du")).toBe(false);
    expect(shouldSuggest("  du  ")).toBe(false);
    expect(shouldSuggest("dun")).toBe(true);
    expect(shouldSuggest("d u")).toBe(true);
    expect(shouldSuggest("")).toBe(false);
  });
  it("builds literal ILIKE patterns per word", () => {
    expect(likePatterns("Hobbit tolkien")).toEqual(["%hobbit%", "%tolkien%"]);
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
    expect(likePatterns("50% off")).toEqual(["%50\\%%", "%off%"]);
  });
});

describe("SuggestionCache", () => {
  it("stores and returns values", () => {
    const c = new SuggestionCache<number[]>(3);
    c.set("a", [1]);
    expect(c.get("a")).toEqual([1]);
    expect(c.get("b")).toBeUndefined();
  });
  it("caches empty results", () => {
    const c = new SuggestionCache<number[]>();
    c.set("none", []);
    expect(c.has("none")).toBe(true);
    expect(c.get("none")).toEqual([]);
  });
  it("evicts the least recently used entry", () => {
    const c = new SuggestionCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.has("b")).toBe(false);
    expect(c.has("a")).toBe(true);
    expect(c.size).toBe(2);
  });
});

describe("mergeSuggestions", () => {
  it("puts library books before online ones", () => {
    const out = mergeSuggestions([lib({ id: "1", title: "Emma", authors: ["Jane Austen"] })], [online({ title: "Persuasion", authors: ["Jane Austen"] })]);
    expect(out.map((s) => s.kind)).toEqual(["library", "online"]);
  });
  it("drops online results matching a library book by ISBN", () => {
    const out = mergeSuggestions(
      [lib({ id: "1", title: "Dune", isbn13: "9780441172719" })],
      [online({ title: "Dune (Deluxe edition)", authors: ["F. Herbert"], isbn13: "9780441172719" }), online({ title: "Dune Messiah", isbn13: "9780593098233" })],
    );
    expect(out.map((s) => s.book.title)).toEqual(["Dune", "Dune Messiah"]);
  });
  it("drops online results matching by normalized title and author", () => {
    const out = mergeSuggestions(
      [lib({ id: "1", title: "The Name of the Wind", authors: ["Patrick Rothfuss"] })],
      [online({ title: "Name of the wind", authors: ["Rothfuss, Patrick"] }), online({ title: "The Wise Man's Fear", authors: ["Patrick Rothfuss"] })],
    );
    expect(out.map((s) => s.book.title)).toEqual(["The Name of the Wind", "The Wise Man's Fear"]);
  });
  it("keeps a same-titled book by a different author", () => {
    const out = mergeSuggestions([lib({ id: "1", title: "Dune", authors: ["Frank Herbert"] })], [online({ title: "Dune", authors: ["Someone Else"] })]);
    expect(out).toHaveLength(2);
  });
  it("dedupes within online results and applies limits", () => {
    const many = Array.from({ length: 12 }, (_, i) => online({ title: `Book ${i}`, isbn13: `97800000000${String(i).padStart(2, "0")}` }));
    const libs = Array.from({ length: 7 }, (_, i) => lib({ id: String(i), title: `Mine ${i}`, authors: [`A${i}`] }));
    const out = mergeSuggestions(libs, [many[0], ...many]);
    expect(out.filter((s) => s.kind === "library")).toHaveLength(5);
    expect(out.filter((s) => s.kind === "online")).toHaveLength(8);
    expect(new Set(out.map((s) => s.key)).size).toBe(out.length);
  });
});

describe("announce", () => {
  it("describes counts", () => {
    expect(announce(2, 5, false)).toBe("2 in your library, 5 online.");
    expect(announce(0, 0, false)).toBe("No matches.");
    expect(announce(0, 0, true)).toBe("Searching.");
  });
});
