import { describe, expect, it } from "vitest";
import { authorSurname, findDuplicates, normalizeTitle, titleAuthorKey, type ExistingBook } from "./duplicates";

const dune: ExistingBook = {
  id: "1",
  title: "Dune",
  authors: ["Frank Herbert"],
  isbn13: "9780441172719",
  copyIsbns: ["9780593099322"],
};
const hobbit: ExistingBook = { id: "2", title: "The Hobbit", authors: ["J.R.R. Tolkien"], isbn13: null, copyIsbns: [] };

describe("normalizeTitle", () => {
  it("ignores case, accents, punctuation and leading articles", () => {
    expect(normalizeTitle("The Hobbit")).toBe("hobbit");
    expect(normalizeTitle("  HOBBIT!  ")).toBe("hobbit");
    expect(normalizeTitle("Les Misérables")).toBe("les miserables");
    expect(normalizeTitle("Harry Potter & the Chamber")).toBe("harry potter and the chamber");
  });
  it("keeps a lone article-word title", () => {
    expect(normalizeTitle("A")).toBe("a");
  });
});

describe("authorSurname", () => {
  it("handles both name orders and initials", () => {
    expect(authorSurname("Tolkien, J. R. R.")).toBe("tolkien");
    expect(authorSurname("J.R.R. Tolkien")).toBe("tolkien");
    expect(authorSurname(undefined)).toBe("");
  });
  it("builds the key", () => {
    expect(titleAuthorKey("The Hobbit", ["J. R. R. Tolkien"])).toBe(titleAuthorKey("Hobbit", ["Tolkien, J.R.R."]));
  });
});

describe("findDuplicates", () => {
  it("matches by books.isbn13", () => {
    const m = findDuplicates({ title: "Whatever", authors: [], isbn13: "9780441172719" }, [dune, hobbit]);
    expect(m).toEqual([{ book: dune, reason: "isbn" }]);
  });
  it("matches by a copy's edition isbn", () => {
    const m = findDuplicates({ title: "x", authors: [], isbn13: "9780593099322" }, [dune]);
    expect(m[0]).toEqual({ book: dune, reason: "isbn" });
  });
  it("falls back to title and first author", () => {
    const m = findDuplicates({ title: "Hobbit", authors: ["Tolkien, J.R.R.", "Someone"], isbn13: "9780261102217" }, [dune, hobbit]);
    expect(m).toEqual([{ book: hobbit, reason: "title" }]);
  });
  it("does not match the same title by a different author", () => {
    expect(findDuplicates({ title: "Dune", authors: ["Someone Else"], isbn13: null }, [dune])).toEqual([]);
  });
  it("lists an ISBN match once", () => {
    const m = findDuplicates({ title: "Dune", authors: ["Frank Herbert"], isbn13: "9780441172719" }, [dune]);
    expect(m).toHaveLength(1);
    expect(m[0].reason).toBe("isbn");
  });
});
