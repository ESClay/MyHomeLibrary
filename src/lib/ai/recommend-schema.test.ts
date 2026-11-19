import { describe, expect, it } from "vitest";
import { MAX_PICKS, PERSONAL_SCHEMA, SHARED_SCHEMA, parsePicks, schemaFor } from "./recommend-schema";

const personal = (picks: unknown[]) => JSON.stringify({ picks });

describe("parsePicks (personal)", () => {
  it("parses well-formed picks", () => {
    const out = parsePicks(
      personal([{ category: "shelves", title: "  The Left Hand of Darkness ", authors: ["Ursula K. Le Guin"], reason: "You loved Dune.\nIt shares its politics.", series: "Hainish Cycle", seriesPosition: 4 }]),
      "personal",
    );
    expect(out).toEqual({
      ok: true,
      dropped: 0,
      picks: [
        {
          title: "The Left Hand of Darkness",
          authors: ["Ursula K. Le Guin"],
          reason: "You loved Dune. It shares its politics.",
          fit: [],
          series: "Hainish Cycle",
          seriesPosition: 4,
          category: "shelves",
        },
      ],
    });
  });

  it("drops malformed, authorless and reasonless picks and counts them", () => {
    const out = parsePicks(
      personal([
        { category: "ratings", title: "Good", authors: ["A"], reason: "ok", series: null, seriesPosition: null },
        { category: "ratings", title: "No author", authors: [], reason: "ok", series: null, seriesPosition: null },
        { category: "ratings", title: "No reason", authors: ["A"], reason: "  ", series: null, seriesPosition: null },
        { authors: ["A"], reason: "no title" },
        "nonsense",
      ]),
      "personal",
    );
    expect(out).toMatchObject({ ok: true, dropped: 4 });
    expect(out.ok && out.picks.map((p) => p.title)).toEqual(["Good"]);
  });

  it("ignores a series position without a series or a negative one", () => {
    const out = parsePicks(personal([{ category: "authors", title: "A", authors: ["B"], reason: "r", series: null, seriesPosition: 3 }, { category: "authors", title: "C", authors: ["D"], reason: "r", series: "S", seriesPosition: -1 }]), "personal");
    expect(out.ok && out.picks.map((p) => p.seriesPosition)).toEqual([null, null]);
  });

  it("keeps the group of each pick and drops picks with an unknown, missing or unasked-for group", () => {
    const pick = (title: string, category?: string) => ({ ...(category ? { category } : {}), title, authors: ["A"], reason: "r", series: null, seriesPosition: null });
    const text = personal([pick("S", "shelves"), pick("R", "ratings"), pick("U", "authors"), pick("Bad", "other"), pick("None")]);
    const all = parsePicks(text, "personal");
    expect(all.ok && all.picks.map((p) => `${p.title}:${p.category}`)).toEqual(["S:shelves", "R:ratings", "U:authors"]);
    expect(all.ok && all.dropped).toBe(2);
    const some = parsePicks(text, "personal", [], ["shelves", "authors"]);
    expect(some.ok && some.picks.map((p) => p.title)).toEqual(["S", "U"]);
  });

  it("rejects non-JSON and the wrong shape", () => {
    expect(parsePicks("not json", "personal")).toEqual({ ok: false });
    expect(parsePicks("{}", "personal")).toEqual({ ok: false });
    expect(parsePicks('{"picks":"x"}', "personal")).toEqual({ ok: false });
  });

  it("caps the number of picks", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ category: "shelves", title: `T${i}`, authors: ["A"], reason: "r", series: null, seriesPosition: null }));
    const out = parsePicks(personal(many), "personal");
    expect(out.ok && out.picks).toHaveLength(MAX_PICKS);
  });
});

describe("parsePicks (shared)", () => {
  const people = ["Alice", "Bob"];

  it("keeps a fit line per known person, matching names case-insensitively", () => {
    const out = parsePicks(
      personal([{ title: "Piranesi", authors: ["Susanna Clarke"], fit: [{ person: "alice", why: "Loves gentle strangeness." }, { person: "BOB", why: "Likes puzzles." }, { person: "Eve", why: "ignored" }], series: null, seriesPosition: null }]),
      "shared",
      people,
    );
    expect(out.ok && out.picks[0].fit).toEqual([
      { person: "Alice", why: "Loves gentle strangeness." },
      { person: "Bob", why: "Likes puzzles." },
    ]);
    expect(out.ok && out.picks[0].reason).toBe("Alice: Loves gentle strangeness. Bob: Likes puzzles.");
  });

  it("drops a pick with no valid fit line", () => {
    const out = parsePicks(personal([{ title: "X", authors: ["Y"], fit: [{ person: "Nobody", why: "?" }], series: null, seriesPosition: null }]), "shared", people);
    expect(out).toEqual({ ok: true, picks: [], dropped: 1 });
  });
});

describe("schemas", () => {
  it("require every property so decoding is strict, with nullable optionals", () => {
    for (const s of [PERSONAL_SCHEMA, SHARED_SCHEMA]) {
      const item = s.properties.picks.items;
      expect(item.additionalProperties).toBe(false);
      expect(Object.keys(item.properties).sort()).toEqual([...item.required].sort());
      expect(item.properties.series.type).toEqual(["string", "null"]);
    }
    const cat = PERSONAL_SCHEMA.properties.picks.items.properties.category;
    expect(cat.enum).toEqual(["shelves", "ratings", "authors"]);
    expect(PERSONAL_SCHEMA.properties.picks.items.required).toContain("category");
    expect(schemaFor("personal")).toBe(PERSONAL_SCHEMA);
    expect(schemaFor("shared")).toBe(SHARED_SCHEMA);
  });
});
