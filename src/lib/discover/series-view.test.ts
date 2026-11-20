import { describe, expect, it } from "vitest";
import type { SeriesGap } from "./gaps";
import { foldText, parseSeriesSort, totalMissing, viewSeries } from "./series-view";

function gap(name: string, missing: number, opts: { author?: string; pending?: boolean } = {}): SeriesGap {
  return {
    series: { id: name, name, hardcoverId: null, syncedAt: null, authorName: opts.author ?? null },
    owned: 1,
    total: 1 + missing,
    volumes: [],
    missing: Array.from({ length: missing }, (_, i) => ({ id: `${name}${i}` }) as SeriesGap["missing"][number]),
    pending: opts.pending ?? false,
  };
}

const gaps = [gap("Zed", 3), gap("Álpha", 1, { author: "Éva Brontë" }), gap("Mid", 3), gap("Pending", 0, { pending: true }), gap("Beta", 5)];
const names = (g: SeriesGap[]) => g.map((x) => x.series.name);

describe("viewSeries", () => {
  it("puts the fewest missing first, ties by name, pending last", () => {
    expect(names(viewSeries(gaps, "", "fewest"))).toEqual(["Álpha", "Mid", "Zed", "Beta", "Pending"]);
  });
  it("puts the most missing first, pending last", () => {
    expect(names(viewSeries(gaps, "", "most"))).toEqual(["Beta", "Mid", "Zed", "Álpha", "Pending"]);
  });
  it("sorts A to Z", () => {
    expect(names(viewSeries(gaps, "", "az"))).toEqual(["Álpha", "Beta", "Mid", "Pending", "Zed"]);
  });
  it("filters by series name, ignoring case and accents", () => {
    expect(names(viewSeries(gaps, "ALPHA", "az"))).toEqual(["Álpha"]);
    expect(names(viewSeries(gaps, "alph", "az"))).toEqual(["Álpha"]);
  });
  it("filters by author, ignoring case and accents", () => {
    expect(names(viewSeries(gaps, "eva bronte", "az"))).toEqual(["Álpha"]);
  });
  it("returns nothing when nothing matches and never mutates the input", () => {
    const copy = [...gaps];
    expect(viewSeries(gaps, "zzzz", "az")).toEqual([]);
    expect(gaps).toEqual(copy);
  });
});

describe("helpers", () => {
  it("folds text", () => expect(foldText("  Éva   BRONTË ")).toBe("eva bronte"));
  it("falls back to the default sort", () => {
    expect(parseSeriesSort("nope")).toBe("fewest");
    expect(parseSeriesSort("most")).toBe("most");
  });
  it("totals missing volumes without pending series", () => expect(totalMissing(gaps)).toBe(12));
});
