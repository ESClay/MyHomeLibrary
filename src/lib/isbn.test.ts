import { describe, expect, it } from "vitest";
import { cleanIsbn, isbn10To13, isIsbn13, looksLikeIsbn, toIsbn13 } from "./isbn";

describe("isbn", () => {
  it("converts ISBN-10 to ISBN-13", () => {
    expect(isbn10To13("0441172717")).toBe("9780441172719");
    expect(isbn10To13("0-306-40615-2")).toBe("9780306406157");
    expect(isbn10To13("080442957X")).toBe("9780804429573");
  });
  it("rejects bad check digits", () => {
    expect(isbn10To13("0441172718")).toBeNull();
    expect(isIsbn13("9780441172718")).toBe(false);
    expect(toIsbn13("9780441172718")).toBeNull();
  });
  it("normalizes hyphens and spaces", () => {
    expect(cleanIsbn("978-0-441-17271-9")).toBe("9780441172719");
    expect(toIsbn13("978 0 441 17271 9")).toBe("9780441172719");
    expect(toIsbn13("0441172717")).toBe("9780441172719");
    expect(toIsbn13("nope")).toBeNull();
  });
  it("detects ISBN-looking queries", () => {
    expect(looksLikeIsbn("9780441172719")).toBe(true);
    expect(looksLikeIsbn("dune")).toBe(false);
    expect(looksLikeIsbn("12345")).toBe(false);
  });
});
