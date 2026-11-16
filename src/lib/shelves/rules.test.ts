import { describe, expect, it } from "vitest";
import { applyLibraryQuery, parseLibraryParams, type LibraryItem } from "@/lib/books/library-query";
import { evaluateSmart } from "./content";
import { describeRules, hasRules, paramsFromRules, readRules, rulesFromParams, saveRulesSchema } from "./rules";

function item(over: Partial<LibraryItem> & { id: string; title: string }): LibraryItem {
  return {
    authors: [],
    seriesName: null,
    seriesPosition: null,
    coverUrl: null,
    ownership: "owned",
    publicRating: null,
    createdAt: "2026-01-01T00:00:00Z",
    formats: [],
    totalPaid: null,
    mine: null,
    others: [],
    ...over,
  };
}

const items = [
  item({ id: "1", title: "Dune", authors: ["Frank Herbert"], formats: ["hardcover"], mine: { status: "read", rating: 5 } }),
  item({ id: "2", title: "Emma", authors: ["Jane Austen"], formats: ["ebook"], mine: { status: "reading", rating: null }, others: [{ userId: "u2", status: "read" }] }),
  item({ id: "3", title: "Persuasion", authors: ["Jane Austen"], ownership: "wishlist", mine: null, others: [{ userId: "u2", status: "reading" }] }),
];

describe("rules validation", () => {
  it("drops unknown keys and invalid values on read", () => {
    expect(readRules({ my: "reading", format: "scroll", bogus: 1, rating: 4, q: "  emma " })).toEqual({ my: "reading", rating: 4, q: "emma" });
    expect(readRules(null)).toEqual({});
    expect(readRules([1, 2])).toEqual({});
    expect(readRules("x")).toEqual({});
  });

  it("strips unknown keys on save and demands at least one rule", () => {
    expect(saveRulesSchema.safeParse({}).success).toBe(false);
    expect(saveRulesSchema.safeParse({ my: "dancing" }).success).toBe(false);
    const ok = saveRulesSchema.safeParse({ own: "owned", junk: true });
    expect(ok.success && ok.data).toEqual({ own: "owned" });
    expect(saveRulesSchema.safeParse({ rating: 6 }).success).toBe(false);
    expect(saveRulesSchema.safeParse({ rating: "unrated" }).success).toBe(true);
  });

  it("hasRules is false for an empty set", () => {
    expect(hasRules({})).toBe(false);
    expect(hasRules({ q: "x" })).toBe(true);
  });
});

describe("round trip with the library query", () => {
  it("params -> rules -> params keeps every filter", () => {
    const p = parseLibraryParams({ q: "jane", my: "none", partner: "reading", format: "ebook", own: "owned", series: "S", rating: "3.5", sort: "title" });
    const rules = rulesFromParams(p);
    expect(rules).toEqual({ q: "jane", my: "none", partner: "reading", format: "ebook", own: "owned", series: "S", rating: 3.5 });
    const back = paramsFromRules(rules, "title");
    for (const k of ["q", "my", "partner", "format", "own", "series", "rating"] as const) expect(back[k]).toEqual(p[k]);
  });

  it("the unrated sentinel survives", () => {
    const rules = rulesFromParams(parseLibraryParams({ rating: "unrated" }));
    expect(rules).toEqual({ rating: "unrated" });
    expect(paramsFromRules(rules).rating).toBe("unrated");
  });

  it("a smart shelf returns exactly what the library list returns for the same filters", () => {
    const raw = { my: "reading", partner: undefined, own: "owned" } as const;
    const params = parseLibraryParams({ ...raw, sort: "title" });
    const viaLibrary = applyLibraryQuery(items, params).map((i) => i.id);
    const viaShelf = evaluateSmart(items, { rules: rulesFromParams(params), sort: "title" }).map((i) => i.id);
    expect(viaShelf).toEqual(viaLibrary);
    expect(viaShelf).toEqual(["2"]);
  });

  it("evaluates my status for the viewer, whoever that is", () => {
    const rules = { my: "reading" as const };
    expect(evaluateSmart(items, { rules, sort: "title" }).map((i) => i.id)).toEqual(["2"]);
    // The same rules for a viewer whose items carry different "mine" values.
    const theirs = [item({ id: "9", title: "Zorba", mine: { status: "reading", rating: null } }), item({ id: "8", title: "Yes", mine: null })];
    expect(evaluateSmart(theirs, { rules, sort: "title" }).map((i) => i.id)).toEqual(["9"]);
  });

  it("partner rules look at the other members", () => {
    expect(evaluateSmart(items, { rules: { partner: "reading" }, sort: "title" }).map((i) => i.id)).toEqual(["3"]);
  });

  it("describes rules as readable chips", () => {
    const labels = describeRules({ my: "reading", partner: "read", format: "ebook", rating: 4, series: "Dune" }).map((c) => c.label);
    expect(labels).toEqual(["I: reading", "Partner: read", "E-book", "Series: Dune", "4 stars and up"]);
  });
});
