import { describe, expect, it } from "vitest";
import { MAX_DETECTED, OUTPUT_SCHEMA, orderDetections, parseModelOutput, type DetectedBook } from "./identify-schema";

const book = (over: Record<string, unknown> = {}) => ({
  title: "Dune",
  authors: ["Frank Herbert"],
  series: null,
  seriesPosition: null,
  isbn: null,
  confidence: 0.95,
  kind: "cover",
  index: 0,
  ...over,
});
const answer = (books: unknown[]) => JSON.stringify({ books });

describe("parseModelOutput", () => {
  it("reads a well-formed answer", () => {
    const r = parseModelOutput(answer([book({ series: "Dune", seriesPosition: 1, isbn: "9780441172719" })]));
    expect(r).toEqual({
      ok: true,
      dropped: 0,
      books: [
        {
          title: "Dune",
          authors: ["Frank Herbert"],
          series: "Dune",
          seriesPosition: 1,
          isbn: "9780441172719",
          confidence: 0.95,
          kind: "cover",
          index: 0,
        },
      ],
    });
  });

  it("treats an empty list as a valid answer", () => {
    expect(parseModelOutput(answer([]))).toEqual({ ok: true, books: [], dropped: 0 });
  });

  it("keeps low-confidence books rather than hiding them", () => {
    const r = parseModelOutput(answer([book({ title: "Wuth...ng Hei...", confidence: 0.2, kind: "spine" })]));
    expect(r.ok && r.books[0]).toMatchObject({ title: "Wuth...ng Hei...", confidence: 0.2, kind: "spine" });
  });

  it("clamps confidence into 0..1", () => {
    const r = parseModelOutput(answer([book({ confidence: 1.7 }), book({ title: "B", confidence: -3, index: 1 })]));
    expect(r.ok && r.books.map((b) => b.confidence)).toEqual([1, 0]);
  });

  it("rejects text that is not JSON", () => {
    expect(parseModelOutput("Here are the books: Dune")).toEqual({ ok: false, reason: "invalid_json" });
    expect(parseModelOutput('{"books": [')).toEqual({ ok: false, reason: "invalid_json" });
  });

  it("rejects JSON of the wrong shape", () => {
    expect(parseModelOutput("[]")).toEqual({ ok: false, reason: "wrong_shape" });
    expect(parseModelOutput('{"titles": []}')).toEqual({ ok: false, reason: "wrong_shape" });
    expect(parseModelOutput('{"books": "none"}')).toEqual({ ok: false, reason: "wrong_shape" });
  });

  it("drops malformed entries and counts them", () => {
    const r = parseModelOutput(
      answer([
        book(),
        null,
        "Dune",
        book({ title: "   " }), // no title
        book({ title: "No confidence", confidence: "high" }),
        { authors: ["x"], confidence: 0.5 }, // no title at all
      ]),
    );
    expect(r.ok && r.books).toHaveLength(1);
    expect(r.ok && r.dropped).toBe(5);
  });

  it("only keeps an ISBN that passes the checksum", () => {
    const r = parseModelOutput(
      answer([book({ isbn: "978-0-441-17271-9" }), book({ title: "B", isbn: "9780441172718", index: 1 }), book({ title: "C", isbn: "0441172717", index: 2 })]),
    );
    expect(r.ok && r.books.map((b) => b.isbn)).toEqual(["9780441172719", null, "9780441172719"]);
  });

  it("ignores a series position when there is no series", () => {
    const r = parseModelOutput(answer([book({ series: null, seriesPosition: 3 })]));
    expect(r.ok && r.books[0].seriesPosition).toBeNull();
  });

  it("tidies whitespace, caps authors and falls back on an unknown kind", () => {
    const r = parseModelOutput(answer([book({ title: "  The   Hobbit \n", authors: [" J. R. R.  Tolkien ", ""], kind: "poster" })]));
    expect(r.ok && r.books[0]).toMatchObject({ title: "The Hobbit", authors: ["J. R. R. Tolkien"], kind: "spine" });
  });

  it("caps how many books one photo can produce", () => {
    const many = Array.from({ length: MAX_DETECTED + 5 }, (_, i) => book({ title: `Book ${i}`, index: i }));
    const r = parseModelOutput(answer(many));
    expect(r.ok && r.books).toHaveLength(MAX_DETECTED);
    expect(r.ok && r.dropped).toBe(5);
  });
});

describe("orderDetections", () => {
  const d = (title: string, index: number | null): DetectedBook => ({
    title,
    authors: [],
    series: null,
    seriesPosition: null,
    isbn: null,
    confidence: 0.9,
    kind: "spine",
    index,
  });

  it("follows the shelf order given by index", () => {
    expect(orderDetections([d("c", 2), d("a", 0), d("b", 1)]).map((b) => b.title)).toEqual(["a", "b", "c"]);
  });

  it("puts books without a position after the positioned ones, in the order given", () => {
    expect(orderDetections([d("x", null), d("b", 1), d("y", null), d("a", 0)]).map((b) => b.title)).toEqual(["a", "b", "x", "y"]);
  });

  it("keeps the model's order when positions tie", () => {
    expect(orderDetections([d("p", 1), d("q", 1)]).map((b) => b.title)).toEqual(["p", "q"]);
  });

  it("is applied when parsing", () => {
    const r = parseModelOutput(answer([book({ title: "Third", index: 2 }), book({ title: "First", index: 0 }), book({ title: "Second", index: 1 })]));
    expect(r.ok && r.books.map((b) => b.title)).toEqual(["First", "Second", "Third"]);
  });
});

describe("OUTPUT_SCHEMA", () => {
  it("is strict: every property is required and nothing extra is allowed", () => {
    const item = OUTPUT_SCHEMA.properties.books.items;
    expect(OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(item.additionalProperties).toBe(false);
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
  });
});
