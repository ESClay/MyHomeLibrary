import { describe, expect, it } from "vitest";
import { parseCalibreCsv } from "./parse";
import {
  applyMapping,
  defaultChoice,
  defaultValueMap,
  distinctValues,
  looksLikeDateColumn,
  normalizeValue,
  parseReadDate,
  suggestColumns,
} from "./read-map";
import type { ReadMapping } from "./types";

const csv = [
  "title,#read,#finished,#status,#notes",
  '"A","True","2021-03-12T00:00:00+00:00","Read","x"',
  '"B","False","","Reading",""',
  '"C","","","Want to read",""',
  '"D","True","","DNF","y"',
  '"E","Yes","not a date","something odd",""',
  '"F","TRUE","2020-01-01T00:00:00+00:00","",""',
].join("\n");

async function rows() {
  return parseCalibreCsv(csv, { yieldFn: async () => {} });
}

describe("distinct values", () => {
  it("counts values case-insensitively, most common first, blanks included", async () => {
    const { rows: r } = await rows();
    const v = distinctValues(r, "#read");
    expect(v.map((x) => [x.key, x.count])).toEqual([
      ["true", 3],
      ["", 1],
      ["false", 1],
      ["yes", 1],
    ].sort((a, b) => (b[1] as number) - (a[1] as number) || String(a[0]).localeCompare(String(b[0]))));
    expect(v.find((x) => x.key === "")?.label).toBe("(blank)");
    expect(v.find((x) => x.key === "true")?.count).toBe(3);
  });
});

describe("default choices", () => {
  it("booleans default to read, false and blank to ignore", () => {
    for (const t of ["true", "yes", "y", "1", "✓", "✔"]) expect(defaultChoice(normalizeValue(t))).toBe("read");
    for (const f of ["false", "no", "0", "", "✗"]) expect(defaultChoice(normalizeValue(f))).toBe("ignore");
  });

  it("recognizes status words", () => {
    expect(defaultChoice("reading")).toBe("reading");
    expect(defaultChoice("to read")).toBe("want");
    expect(defaultChoice("dnf")).toBe("dnf");
    expect(defaultChoice("finished")).toBe("read");
    expect(defaultChoice("something odd")).toBe("ignore");
  });

  it("builds a map for every distinct value", async () => {
    const { rows: r } = await rows();
    const map = defaultValueMap(distinctValues(r, "#status"));
    expect(map).toEqual({ read: "read", reading: "reading", "want to read": "want", dnf: "dnf", "something odd": "ignore", "": "ignore" });
  });
});

describe("column suggestions", () => {
  it("picks a read column and a date column", async () => {
    const cat = await rows();
    expect(looksLikeDateColumn(cat.rows, "#finished")).toBe(true);
    expect(looksLikeDateColumn(cat.rows, "#read")).toBe(false);
    expect(suggestColumns(cat.rows, cat.customColumns)).toEqual({ status: "#read", date: "#finished" });
  });
});

describe("applyMapping", () => {
  const mapping = (over: Partial<ReadMapping> = {}): ReadMapping => ({
    statusColumn: "#read",
    dateColumn: "#finished",
    valueMap: { true: "read", yes: "read", false: "ignore", "": "ignore" },
    ...over,
  });

  it("a read book with a date gets finished_at and no start", async () => {
    const { rows: r } = await rows();
    expect(applyMapping(r[0], mapping())).toEqual({ status: "read", finishedAt: "2021-03-12" });
  });

  it("false and blank are left without a status", async () => {
    const { rows: r } = await rows();
    expect(applyMapping(r[1], mapping())).toEqual({ status: null, finishedAt: null });
    expect(applyMapping(r[2], mapping())).toEqual({ status: null, finishedAt: null });
  });

  it("read without a date is still read", async () => {
    const { rows: r } = await rows();
    expect(applyMapping(r[3], mapping())).toEqual({ status: "read", finishedAt: null });
  });

  it("an unparseable date is dropped and an unmapped value counts as ignore", async () => {
    const { rows: r } = await rows();
    expect(applyMapping(r[4], mapping())).toEqual({ status: "read", finishedAt: null });
    expect(applyMapping(r[4], mapping({ statusColumn: "#status", valueMap: {} }))).toEqual({ status: null, finishedAt: null });
  });

  it("a date is only used when the status is read", async () => {
    const { rows: r } = await rows();
    const m = mapping({ statusColumn: "#read", valueMap: { true: "reading" } });
    expect(applyMapping(r[0], m)).toEqual({ status: "reading", finishedAt: null });
  });

  it("with no status column, a date alone means read", async () => {
    const { rows: r } = await rows();
    const m = mapping({ statusColumn: null });
    expect(applyMapping(r[0], m)).toEqual({ status: "read", finishedAt: "2021-03-12" });
    expect(applyMapping(r[1], m)).toEqual({ status: null, finishedAt: null });
  });

  it("maps free-text status words, and no mapping at all does nothing", async () => {
    const { rows: r } = await rows();
    const m: ReadMapping = { statusColumn: "#status", dateColumn: null, valueMap: defaultValueMap(distinctValues(r, "#status")) };
    expect(r.map((x) => applyMapping(x, m).status)).toEqual(["read", "reading", "want", "dnf", null, null]);
    expect(applyMapping(r[0], { statusColumn: null, dateColumn: null, valueMap: {} })).toEqual({ status: null, finishedAt: null });
  });
});

describe("parseReadDate", () => {
  it("accepts ISO dates and rejects the rest", () => {
    expect(parseReadDate("2021-03-12T00:00:00+00:00")).toBe("2021-03-12");
    expect(parseReadDate("2021")).toBeNull();
    expect(parseReadDate("0101-01-01T00:00:00+00:00")).toBeNull();
    expect(parseReadDate("1850-01-01")).toBeNull();
    expect(parseReadDate("")).toBeNull();
  });
});
