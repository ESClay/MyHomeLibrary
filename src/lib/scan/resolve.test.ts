import { describe, expect, it, vi } from "vitest";
import type { DetectedBook } from "@/lib/ai/identify-schema";
import { emptyMetadata } from "@/lib/metadata/util";
import type { BookMetadata } from "@/lib/metadata/types";
import {
  ALTERNATE_THRESHOLD,
  MATCH_THRESHOLD,
  MAX_ALTERNATES,
  rankCandidates,
  resolveAll,
  resolveDetection,
  scoreCandidate,
  toScanItems,
  type Lookups,
} from "./resolve";

const meta = (title: string, authors: string[], isbn13: string | null = null): BookMetadata => ({
  ...emptyMetadata("openlibrary"),
  title,
  authors,
  isbn13,
});
const det = (over: Partial<DetectedBook> = {}): DetectedBook => ({
  title: "Dune",
  authors: ["Frank Herbert"],
  series: null,
  seriesPosition: null,
  isbn: null,
  confidence: 0.9,
  kind: "spine",
  index: 0,
  ...over,
});
const deps = (over: Partial<Lookups> = {}): Lookups => ({
  lookupByIsbn: vi.fn().mockResolvedValue(null),
  search: vi.fn().mockResolvedValue([]),
  ...over,
});

describe("scoreCandidate", () => {
  it("scores an exact title and author highest", () => {
    expect(scoreCandidate(det(), meta("Dune", ["Frank Herbert"]))).toBeCloseTo(1);
  });
  it("ignores articles, case and punctuation", () => {
    expect(scoreCandidate(det({ title: "the hobbit", authors: ["Tolkien"] }), meta("The Hobbit!", ["J.R.R. Tolkien"]))).toBeGreaterThan(0.7);
  });
  it("accepts a spine that shows only the main title of a subtitled book", () => {
    const s = scoreCandidate(det({ title: "Programming Rust", authors: ["Blandy"] }), meta("Programming Rust: Fast, Safe Systems Development", ["Jim Blandy"]));
    expect(s).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });
  it("punishes a different author", () => {
    expect(scoreCandidate(det(), meta("Dune", ["Someone Else"]))).toBeLessThan(0.75);
    expect(scoreCandidate(det({ title: "It", authors: ["Stephen King"] }), meta("It Ends With Us", ["Colleen Hoover"]))).toBeLessThan(MATCH_THRESHOLD);
  });
  it("does not punish a missing author", () => {
    expect(scoreCandidate(det({ authors: [] }), meta("Dune", ["Frank Herbert"]))).toBeGreaterThan(0.8);
  });
  it("scores unrelated titles near zero", () => {
    expect(scoreCandidate(det(), meta("Cooking for Two", ["Someone Else"]))).toBeLessThan(ALTERNATE_THRESHOLD);
  });
});

describe("rankCandidates", () => {
  it("orders best first and removes repeats of the same book", () => {
    const ranked = rankCandidates(det(), [
      meta("Dune Messiah", ["Frank Herbert"], "9780593098233"),
      meta("Dune", ["Frank Herbert"], "9780441172719"),
      meta("Dune", ["Frank Herbert"], "9780441172719"), // same ISBN
      meta("dune", ["Frank Herbert"]), // same title + author
    ]);
    expect(ranked.map((r) => r.c.title)).toEqual(["Dune", "Dune Messiah"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

describe("resolveDetection", () => {
  it("looks an ISBN up first and trusts it when the title roughly agrees", async () => {
    const hit = meta("Dune", ["Frank Herbert"], "9780441172719");
    const d = deps({ lookupByIsbn: vi.fn().mockResolvedValue(hit), search: vi.fn().mockResolvedValue([hit, meta("Dune Messiah", ["Frank Herbert"])]) });
    const r = await resolveDetection(det({ isbn: "9780441172719" }), d);
    expect(d.lookupByIsbn).toHaveBeenCalledWith("9780441172719");
    expect(r.via).toBe("isbn");
    expect(r.best).toBe(hit);
    expect(r.alternates.map((a) => a.title)).toEqual(["Dune Messiah"]); // the best is not repeated
  });

  it("ignores an ISBN hit for a different book (the digits were misread)", async () => {
    const wrong = meta("Cooking for Two", ["Someone Else"], "9780441172719");
    const right = meta("Dune", ["Frank Herbert"]);
    const d = deps({ lookupByIsbn: vi.fn().mockResolvedValue(wrong), search: vi.fn().mockResolvedValue([right]) });
    const r = await resolveDetection(det({ isbn: "9780441172719" }), d);
    expect(r.via).toBe("search");
    expect(r.best).toBe(right);
  });

  it("searches by title and first author when there is no ISBN", async () => {
    const d = deps({ search: vi.fn().mockResolvedValue([meta("Dune", ["Frank Herbert"])]) });
    const r = await resolveDetection(det(), d);
    expect(d.lookupByIsbn).not.toHaveBeenCalled();
    expect(d.search).toHaveBeenCalledWith("Dune Frank Herbert");
    expect(r.via).toBe("search");
  });

  it("searches by title alone when no author was read", async () => {
    const d = deps();
    await resolveDetection(det({ authors: [] }), d);
    expect(d.search).toHaveBeenCalledWith("Dune");
  });

  it("returns no best match when nothing is close, but still lists loose alternates", async () => {
    const d = deps({ search: vi.fn().mockResolvedValue([meta("Dune Messiah", ["Brian Herbert"]), meta("Cooking for Two", ["X"])]) });
    const r = await resolveDetection(det({ title: "Dune Chronicles Companion" }), d);
    expect(r.best).toBeNull();
    expect(r.via).toBe("none");
    expect(r.alternates.map((a) => a.title)).not.toContain("Cooking for Two");
  });

  it("keeps at most three alternates", async () => {
    const results = [meta("Dune", ["Frank Herbert"])];
    for (let i = 0; i < 6; i++) results.push(meta(`Dune Book ${i}`, ["Frank Herbert"]));
    const r = await resolveDetection(det(), deps({ search: vi.fn().mockResolvedValue(results) }));
    expect(r.alternates).toHaveLength(MAX_ALTERNATES);
  });

  it("survives lookup failures", async () => {
    const d = deps({ lookupByIsbn: vi.fn().mockRejectedValue(new Error("down")), search: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(resolveDetection(det({ isbn: "9780441172719" }), d)).resolves.toEqual({ best: null, alternates: [], via: "none" });
  });
});

describe("resolveAll / toScanItems", () => {
  it("resolves every detection and keeps the shelf order", async () => {
    const titles = ["A Book", "B Book", "C Book"];
    const search = vi.fn(async (q: string) => {
      await new Promise((r) => setTimeout(r, q.startsWith("A") ? 15 : 1)); // the first answers last
      return [meta(q.split(" Book")[0] + " Book", ["Au Thor"])];
    });
    const detections = titles.map((t, i) => det({ title: t, authors: ["Au Thor"], index: i }));
    const out = await resolveAll(detections, deps({ search }), 2);
    expect(out.map((r) => r.best?.title)).toEqual(titles);
  });

  it("builds review items in the same order with ids and duplicates", () => {
    const detections = [det({ title: "One" }), det({ title: "Two" })];
    const res = [
      { best: meta("One", []), alternates: [], via: "search" as const },
      { best: null, alternates: [], via: "none" as const },
    ];
    const items = toScanItems(detections, res, [[{ id: "b1", title: "One", authors: [], reason: "title" }]]);
    expect(items.map((i) => [i.id, i.detected.title, i.duplicates.length])).toEqual([
      ["p0", "One", 1],
      ["p1", "Two", 0],
    ]);
  });
});
