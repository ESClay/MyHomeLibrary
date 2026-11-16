import { describe, expect, it } from "vitest";
import {
  addedByMonth,
  lastMonths,
  niceTicks,
  ownershipTotals,
  ratingDistribution,
  readingByMonth,
  readingByYear,
  readingTotals,
  seriesFor,
  unreadBySeries,
  valueSummary,
  whoOptions,
  yearsWithReads,
  type Person,
  type ReadingRow,
} from "./aggregate";

const me: Person = { id: "u1", name: "Nic", isMe: true };
const anna: Person = { id: "u2", name: "Anna", isMe: false };
const kim: Person = { id: "u3", name: "Kim", isMe: false };

describe("who toggle", () => {
  it("offers only You when the library has one member", () => {
    expect(whoOptions([me])).toEqual([{ who: "me", label: "You" }]);
    expect(seriesFor("both", [me]).map((s) => s.key)).toEqual(["me"]);
    expect(seriesFor("partner", [me]).map((s) => s.key)).toEqual(["me"]);
  });

  it("names the partner when there is one other member, and groups several as Others", () => {
    expect(whoOptions([me, anna]).map((o) => o.label)).toEqual(["You", "Anna", "Both"]);
    expect(whoOptions([me, anna, kim])[1].label).toBe("Others");
    expect(seriesFor("both", [me, anna, kim])).toEqual([
      { key: "me", label: "You", userIds: ["u1"] },
      { key: "partner", label: "Others", userIds: ["u2", "u3"] },
    ]);
    expect(seriesFor("partner", [me, anna])).toEqual([{ key: "partner", label: "Anna", userIds: ["u2"] }]);
  });
});

const rows: ReadingRow[] = [
  { userId: "u1", month: "2024-03-01", books: 2, pages: 600 },
  { userId: "u1", month: "2026-01-01", books: 1, pages: 300 },
  { userId: "u1", month: "2026-03-01", books: 3, pages: 900 },
  { userId: "u2", month: "2025-03-01", books: 4, pages: 1200 },
  { userId: "u2", month: "2026-03-01", books: 1, pages: 250 },
];

describe("reading", () => {
  const both = seriesFor("both", [me, anna]);

  it("sums books per year per person, filling the years in between", () => {
    const { years, values } = readingByYear(rows, both, "books");
    expect(years).toEqual([2024, 2025, 2026]);
    expect(values).toEqual([
      [2, 0, 4],
      [0, 4, 1],
    ]);
  });

  it("sums pages instead when asked", () => {
    expect(readingByYear(rows, seriesFor("me", [me, anna]), "pages").values).toEqual([[600, 0, 1200]]);
  });

  it("returns empty series when nobody has finished anything", () => {
    expect(readingByYear([], both, "books")).toEqual({ years: [], values: [[], []] });
  });

  it("buckets one year by month", () => {
    const [mine, theirs] = readingByMonth(rows, both, 2026, "books");
    expect(mine[0]).toBe(1);
    expect(mine[2]).toBe(4 - 1); // the March 2026 row
    expect(mine.reduce((a, b) => a + b, 0)).toBe(4);
    expect(theirs[2]).toBe(1);
    expect(mine).toHaveLength(12);
  });

  it("lists years with reads, newest first, only for the people shown", () => {
    expect(yearsWithReads(rows, both)).toEqual([2026, 2025, 2024]);
    expect(yearsWithReads(rows, seriesFor("me", [me, anna]))).toEqual([2026, 2024]);
  });

  it("totals what the toggle shows", () => {
    expect(readingTotals(rows, both)).toEqual({ books: 11, pages: 3250 });
    expect(readingTotals(rows, seriesFor("partner", [me, anna]))).toEqual({ books: 5, pages: 1450 });
  });
});

describe("ratings", () => {
  it("buckets half-star ratings per series", () => {
    const dist = ratingDistribution(
      [
        { userId: "u1", halfStars: 10, books: 3 },
        { userId: "u1", halfStars: 1, books: 1 },
        { userId: "u2", halfStars: 8, books: 2 },
        { userId: "u2", halfStars: 0, books: 9 }, // out of range, ignored
      ],
      seriesFor("both", [me, anna]),
    );
    expect(dist[0][9]).toBe(3);
    expect(dist[0][0]).toBe(1);
    expect(dist[1][7]).toBe(2);
    expect(dist[1].reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("growth", () => {
  it("lists the last months oldest first, across a year boundary", () => {
    expect(lastMonths(new Date("2026-02-15T00:00:00Z"), 4)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });

  it("zero-fills books added per month and counts those from before the window", () => {
    const out = addedByMonth(
      [
        { month: "2026-02-01", ownership: "owned", books: 3 },
        { month: "2026-02-01", ownership: "wishlist", books: 1 },
        { month: "2025-12-01", ownership: "owned", books: 2 },
        { month: "2024-06-01", ownership: "owned", books: 7 },
        { month: "2026-02-01", ownership: "borrowed", books: 5 },
      ],
      new Date("2026-02-15T00:00:00Z"),
      4,
    );
    expect(out.added).toEqual([0, 2, 0, 4]);
    expect(out.before).toBe(7);
  });

  it("totals owned, wishlist and borrowed", () => {
    expect(ownershipTotals([{ month: "2026-01-01", ownership: "owned", books: 3 }, { month: "2026-02-01", ownership: "owned", books: 1 }, { month: "2026-02-01", ownership: "borrowed", books: 2 }])).toEqual({ owned: 4, wishlist: 0, borrowed: 2 });
  });

  it("counts unread per series, averaging several other members", () => {
    const out = unreadBySeries(
      [
        { userId: "u1", owned: 10, read: 4, reading: 1, unread: 6 },
        { userId: "u2", owned: 10, read: 2, reading: 0, unread: 8 },
        { userId: "u3", owned: 10, read: 4, reading: 0, unread: 6 },
      ],
      seriesFor("both", [me, anna, kim]),
    );
    expect(out).toEqual([
      { key: "me", label: "You", owned: 10, read: 4, unread: 6 },
      { key: "partner", label: "Others", owned: 10, read: 3, unread: 7 },
    ]);
  });
});

describe("value", () => {
  it("compares market value with what was paid for the same priced copies", () => {
    const s = valueSummary({ copies: 10, priced: 8, unpriced: 1, otherCurrency: 1, estValue: 120, paid: 150, paidPriced: 100 });
    expect(s).toEqual({ diff: 20, diffPct: 20, coverage: 0.8 });
  });

  it("has no difference when nothing is priced", () => {
    expect(valueSummary({ copies: 3, priced: 0, unpriced: 3, otherCurrency: 0, estValue: 0, paid: 40, paidPriced: 0 })).toEqual({ diff: null, diffPct: null, coverage: 0 });
    expect(valueSummary({ copies: 0, priced: 0, unpriced: 0, otherCurrency: 0, estValue: 0, paid: 0, paidPriced: 0 }).coverage).toBe(0);
  });

  it("gives no percentage when nothing was paid", () => {
    expect(valueSummary({ copies: 2, priced: 2, unpriced: 0, otherCurrency: 0, estValue: 30, paid: 0, paidPriced: 0 })).toEqual({ diff: 30, diffPct: null, coverage: 1 });
  });
});

describe("niceTicks", () => {
  it("rounds the axis to even steps above the maximum", () => {
    expect(niceTicks(12)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(1830).at(-1)).toBeGreaterThanOrEqual(1830);
  });
});
