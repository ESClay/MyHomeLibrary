import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyRows } from "./classify";
import { BATCH_SIZE } from "./limits";
import { parseCalibreCsv } from "./parse";
import {
  batchRanges,
  buildJobRows,
  chunk,
  emptySummary,
  estimateSeconds,
  etaSeconds,
  formatDuration,
  jobMappingSchema,
  jobRowSchema,
  mergeSummary,
  readSummary,
  type RowResult,
} from "./plan";
import { defaultValueMap, distinctValues } from "./read-map";
import type { ImportAction, ReadMapping } from "./types";

const fixture = readFileSync(fileURLToPath(new URL("./__fixtures__/calibre-catalog.csv", import.meta.url)), "utf8");

async function entries(library: Parameters<typeof classifyRows>[1] = [], overrides: Record<number, ImportAction> = {}) {
  const { rows } = await parseCalibreCsv(fixture, { yieldFn: async () => {} });
  const classes = classifyRows(rows, library);
  return rows.map((row, i) => ({ row, classification: classes[i], override: overrides[i] }));
}

describe("buildJobRows", () => {
  it("leaves out skipped rows, keeps order and every row validates", async () => {
    const rows = buildJobRows(await entries(), { statusColumn: null, dateColumn: null, valueMap: {} });
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 8, 9]); // not 6 (no title), 7 (repeated uuid)
    for (const r of rows) expect(jobRowSchema.safeParse(r).success).toBe(true);
  });

  it("carries the mapped status and finish date for the importing user", async () => {
    const e = await entries();
    const { rows } = await parseCalibreCsv(fixture, { yieldFn: async () => {} });
    const mapping: ReadMapping = { statusColumn: "#read", dateColumn: "#finished", valueMap: defaultValueMap(distinctValues(rows, "#read")) };
    const job = buildJobRows(e, mapping);
    expect(job[0]).toMatchObject({ status: "read", finishedAt: "2021-03-12", action: "add", calibreUuid: "0a1b2c3d-0000-4000-8000-000000000001" });
    expect(job[1]).toMatchObject({ status: null, finishedAt: null }); // Good Omens: False
    expect(job[2]).toMatchObject({ status: "read", finishedAt: null }); // Wandering Inn: True, blank date
  });

  it("an existing-book row becomes a small copy job aimed at the matching book", async () => {
    const e = await entries([{ id: "11111111-1111-4111-8111-111111111111", title: "x", authors: [], isbn13: "9780261102354", calibreUuid: null, copyIsbns: [] }]);
    const job = buildJobRows(e, { statusColumn: null, dateColumn: null, valueMap: {} });
    expect(job[0]).toMatchObject({ action: "copy", targetBookId: "11111111-1111-4111-8111-111111111111", isbn13: "9780261102354", description: null, calibreUuid: null });
    expect(jobRowSchema.safeParse(job[0]).success).toBe(true);
  });

  it("honours per-row overrides, including skipping a new row and adding a duplicate as its own book", async () => {
    const lib = [{ id: "11111111-1111-4111-8111-111111111111", title: "x", authors: [], isbn13: "9780261102354", calibreUuid: null, copyIsbns: [] }];
    const job = buildJobRows(await entries(lib, { 0: "add", 1: "skip" }), { statusColumn: null, dateColumn: null, valueMap: {} });
    expect(job[0]).toMatchObject({ n: 1, action: "add", targetBookId: null });
    expect(job.find((r) => r.n === 2)).toBeUndefined();
  });

  it("a row repeated inside the file never claims the same uuid twice", async () => {
    const { rows } = await parseCalibreCsv("title,authors,uuid\nSame Book,Ann Lee,u1\nSame Book,Ann Lee,u2\n", { yieldFn: async () => {} });
    const c = classifyRows(rows, []);
    const job = buildJobRows(rows.map((row, i) => ({ row, classification: c[i], override: i === 1 ? ("add" as const) : undefined })), { statusColumn: null, dateColumn: null, valueMap: {} });
    expect(job.map((r) => r.calibreUuid)).toEqual(["u1", null]);
  });

  it("cuts very long descriptions in the stored job", async () => {
    const long = "word ".repeat(2000);
    const { rows } = await parseCalibreCsv(`title,comments\nBig,"${long}"\n`, { yieldFn: async () => {} });
    const c = classifyRows(rows, []);
    const [job] = buildJobRows([{ row: rows[0], classification: c[0], override: undefined }], { statusColumn: null, dateColumn: null, valueMap: {} });
    expect(job.description?.length).toBe(3000);
    expect(job.description?.endsWith("…")).toBe(true);
  });
});

describe("the batch planner", () => {
  it("covers every row once in batches of ten", () => {
    const r = batchRanges(25, 0);
    expect(r).toEqual([[0, 10], [10, 20], [20, 25]]);
    expect(BATCH_SIZE).toBe(10);
  });

  it("resumes from where the job stopped", () => {
    expect(batchRanges(25, 12)).toEqual([[12, 22], [22, 25]]);
    expect(batchRanges(25, 25)).toEqual([]);
    expect(batchRanges(0, 0)).toEqual([]);
    expect(batchRanges(3, -4)).toEqual([[0, 3]]);
  });

  it("chunks uploads", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("estimates", () => {
  it("enrichment dominates the time and a plain import is quick", () => {
    expect(estimateSeconds(1000, 0, true)).toBeGreaterThan(estimateSeconds(1000, 0, false) * 5);
    expect(estimateSeconds(0, 0, true)).toBe(0);
  });

  it("eta uses the measured pace once there is one", () => {
    expect(etaSeconds(100, 0, 0, 1.4)).toBe(140);
    expect(etaSeconds(100, 20, 40_000, 1.4)).toBe(200); // 2 s a row measured
    expect(etaSeconds(0, 20, 40_000, 1.4)).toBeNull();
  });

  it("formats durations", () => {
    expect(formatDuration(20)).toBe("under a minute");
    expect(formatDuration(60)).toBe("about 1 minute");
    expect(formatDuration(600)).toBe("about 10 minutes");
    expect(formatDuration(3600)).toBe("about 1 hour");
    expect(formatDuration(7800)).toBe("about 2 h 10 min");
  });
});

describe("summary", () => {
  const res = (over: Partial<RowResult>): RowResult => ({ n: 1, title: "T", outcome: "added", enriched: false, ...over });

  it("adds a batch to the totals and keeps failures and warnings as issues, capped", () => {
    const s = mergeSummary(
      emptySummary(4),
      [
        res({ outcome: "added", enriched: true }),
        res({ n: 2, outcome: "copied" }),
        res({ n: 3, outcome: "skipped", message: "Already imported." }),
        res({ n: 4, outcome: "failed", message: "Bad" }),
        res({ n: 5, outcome: "added", warning: "Saved, but the finish date was not recorded." }),
      ],
      2,
    );
    expect(s).toMatchObject({ added: 2, copied: 1, skipped: 1, failed: 1, enriched: 1, skippedInReview: 4 });
    expect(s.issues).toEqual([
      { n: 4, title: "T", message: "Bad" },
      { n: 5, title: "T", message: "Saved, but the finish date was not recorded." },
    ]);
  });

  it("readSummary is defensive", () => {
    expect(readSummary(null)).toEqual(emptySummary());
    expect(readSummary({ added: "x", failed: 2, issues: [{ n: 1, message: "m" }, 7] })).toMatchObject({ added: 0, failed: 2, issues: [{ n: 1, title: "", message: "m" }] });
  });
});

describe("job mapping schema", () => {
  it("round-trips the importer's choices", () => {
    const m = { statusColumn: "#read", dateColumn: null, valueMap: { true: "read", "": "ignore" }, enrich: true, expected: 12, shelfIds: [] };
    expect(jobMappingSchema.parse(m)).toEqual(m);
    // Jobs saved before shelves existed still read, with no shelves.
    const { shelfIds: _omit, ...old } = m;
    void _omit;
    expect(jobMappingSchema.parse(old).shelfIds).toEqual([]);
    expect(jobMappingSchema.safeParse({ ...m, valueMap: { x: "finished" } }).success).toBe(false);
  });
});
