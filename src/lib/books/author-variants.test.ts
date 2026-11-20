import { describe, expect, it } from "vitest";
import { findAuthorVariants, foldAuthor, otherSpellings } from "./author-variants";

describe("foldAuthor", () => {
  it("ignores case, accents, punctuation and spacing", () => {
    expect(foldAuthor("Gail Z. Martin")).toBe(foldAuthor("gail z martin"));
    expect(foldAuthor("J.R.R. Tolkien")).toBe(foldAuthor("J. R. R. Tolkien"));
    expect(foldAuthor("Zoë Brontë")).toBe(foldAuthor("Zoe Bronte"));
    expect(foldAuthor("Frank Herbert")).not.toBe(foldAuthor("Brian Herbert"));
  });
});

describe("findAuthorVariants", () => {
  const list = [
    { name: "Gail Z. Martin", books: 5 },
    { name: "Gail Z Martin", books: 1 },
    { name: "Frank Herbert", books: 6 },
    { name: "Brian Herbert", books: 2 },
    { name: "J.R.R. Tolkien", books: 3 },
    { name: "J. R. R. Tolkien", books: 1 },
    { name: "  ", books: 1 },
  ];
  it("returns only people written more than one way, most used spelling first", () => {
    const g = findAuthorVariants(list);
    expect(g.map((x) => x.spellings.map((s) => s.name))).toEqual([
      ["Gail Z. Martin", "Gail Z Martin"],
      ["J.R.R. Tolkien", "J. R. R. Tolkien"],
    ]);
  });
  it("is empty when every author has one spelling", () => {
    expect(findAuthorVariants([{ name: "A B", books: 1 }, { name: "C D", books: 2 }])).toEqual([]);
  });
  it("lists the other spellings of one name", () => {
    const g = findAuthorVariants(list);
    expect(otherSpellings("Gail Z. Martin", g)).toEqual([{ name: "Gail Z Martin", books: 1 }]);
    expect(otherSpellings("Frank Herbert", g)).toEqual([]);
  });
});
