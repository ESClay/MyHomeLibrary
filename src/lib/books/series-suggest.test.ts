import { describe, expect, it } from "vitest";
import { foldSeries, suggestSeries, type SeriesOption } from "./series-suggest";

const options: SeriesOption[] = [
  { name: "Villains", author: "Serena Valentino" },
  { name: "Disney Villains", author: "Serena Valentino" },
  { name: "Ember in the Ashes", author: "Sabaa Tahir" },
  { name: "Éclat", author: "Someone Else" },
  { name: "Shared", author: "Serena Valentino" },
  { name: "Shared", author: "Other" },
];

describe("foldSeries", () => {
  it("ignores case, accents and extra spaces", () => {
    expect(foldSeries("  Éclat  Noir ")).toBe("eclat noir");
  });
});

describe("suggestSeries", () => {
  it("lists the author's series first, then the rest", () => {
    const r = suggestSeries("", "Serena Valentino", options);
    expect(r.byAuthor).toEqual(["Disney Villains", "Shared", "Villains"]);
    expect(r.others).toEqual(["Éclat", "Ember in the Ashes"]);
  });
  it("matches a folded substring", () => {
    const r = suggestSeries("vill", "Sabaa Tahir", options);
    expect(r.byAuthor).toEqual([]);
    expect(r.others).toEqual(["Disney Villains", "Villains"]);
    expect(suggestSeries("ECLAT", "", options).others).toEqual(["Éclat"]);
  });
  it("hints at the existing spelling when only case or accents differ", () => {
    expect(suggestSeries("villains", "Serena Valentino", options).hint).toBe("Villains");
    expect(suggestSeries("eclat", "", options).hint).toBe("Éclat");
  });
  it("gives no hint for an identical or unrelated entry", () => {
    expect(suggestSeries("Villains", "Serena Valentino", options).hint).toBeNull();
    expect(suggestSeries("Vill", "Serena Valentino", options).hint).toBeNull();
  });
  it("works with no options", () => {
    expect(suggestSeries("x", "A", [])).toEqual({ hint: null, byAuthor: [], others: [] });
  });
});
