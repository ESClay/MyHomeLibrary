import { describe, expect, it, vi } from "vitest";
import { RecommendError, type RecommendResult } from "@/lib/ai/recommend";
import { buildPersonalPrompt } from "@/lib/ai/recommend-prompt";
import type { RawPick } from "@/lib/ai/recommend-schema";
import { emptyMetadata } from "@/lib/metadata/util";
import type { BookMetadata } from "@/lib/metadata/types";
import { buildLibraryIndex, inLibrary, workKey } from "./match";
import { buildPickSet, resolvePick, type PickSetDeps } from "./pick-set";

const raw = (title: string, author = "Some Author", over: Partial<RawPick> = {}): RawPick => ({
  title,
  authors: [author],
  reason: `Because ${title}.`,
  fit: [],
  series: null,
  seriesPosition: null,
  ...over,
});

function meta(title: string, author = "Some Author", over: Partial<BookMetadata> = {}): BookMetadata {
  return { ...emptyMetadata("hardcover"), title, authors: [author], ...over };
}

/** A catalogue where every title that is "known" resolves to itself. */
function catalogue(known: BookMetadata[]) {
  return vi.fn(async (query: string) => known.filter((m) => query.toLowerCase().includes(m.title.toLowerCase())));
}

function result(picks: RawPick[], usage = { inputTokens: 1000, outputTokens: 400 }): RecommendResult {
  return { picks, dropped: 0, usage, model: "claude-opus-5-5" };
}

function deps(over: Partial<PickSetDeps> & { rounds: (RecommendResult | (() => Promise<RecommendResult>))[] }): PickSetDeps & { request: ReturnType<typeof vi.fn> } {
  const rounds = [...over.rounds];
  const request = vi.fn(async () => {
    const next = rounds.shift();
    if (!next) throw new Error("no more rounds");
    return typeof next === "function" ? next() : next;
  });
  return {
    prompt: (topUp) => buildPersonalPrompt({ person: { id: "a", name: "Alice" }, rows: [], library: [], feedback: [], topUp }),
    request,
    search: over.search ?? (async () => []),
    inLibrary: over.inLibrary ?? (() => false),
    blocked: over.blocked ?? new Set(),
  };
}

describe("resolvePick", () => {
  it("returns the best title+author match and null for a poor one", async () => {
    const search = catalogue([meta("Piranesi", "Susanna Clarke")]);
    expect((await resolvePick(raw("Piranesi", "Susanna Clarke"), search))?.title).toBe("Piranesi");
    expect(await resolvePick(raw("Piranesi", "Someone Else Entirely"), async () => [meta("Totally Different Book", "Other Person")])).toBeNull();
    expect(await resolvePick(raw("Piranesi"), async () => { throw new Error("down"); })).toBeNull();
  });
});

describe("buildPickSet", () => {
  const known = ["A", "B", "C", "D", "E"].map((t) => meta(`Title ${t}`, "Some Author"));

  it("resolves picks, keeps the model's reason and series, and stops at the target with one call", async () => {
    const d = deps({ rounds: [result([raw("Title A", "Some Author", { series: "Saga", seriesPosition: 1 }), raw("Title B"), raw("Title C")])], search: catalogue(known) });
    const set = await buildPickSet({ scope: "personal", target: 2, deps: d });
    expect(d.request).toHaveBeenCalledTimes(1);
    expect(set.calls).toBe(1);
    expect(set.items.map((i) => i.title)).toEqual(["Title A", "Title B"]);
    expect(set.items[0]).toMatchObject({ key: workKey("Title A", ["Some Author"]), reason: "Because Title A.", series: { name: "Saga", position: 1 } });
    expect(set.usage).toEqual({ inputTokens: 1000, outputTokens: 400 });
    expect(set.model).toBe("claude-opus-5-5");
  });

  it("drops picks that are not found, already in the library, blocked or repeated", async () => {
    const library = buildLibraryIndex([{ title: "Title B", authors: ["Some Author"], isbn13: null, copyIsbns: [], hardcoverId: null }]);
    const d = deps({
      rounds: [result([raw("Title A"), raw("Made Up Book"), raw("Title B"), raw("Title C"), raw("Title A"), raw("Title D")])],
      search: catalogue(known),
      inLibrary: (c) => inLibrary(library, c),
      blocked: new Set([workKey("Title C", ["Some Author"])]),
    });
    const set = await buildPickSet({ scope: "personal", target: 2, deps: d });
    expect(set.items.map((i) => i.title)).toEqual(["Title A", "Title D"]);
    expect(set.dropped).toEqual({ notFound: 1, inLibrary: 1, blocked: 1, duplicate: 1 });
    expect(set.calls).toBe(1);
  });

  it("matches an owned book by ISBN or Hardcover id even when the title differs", async () => {
    const withIsbn = meta("Title A", "Some Author", { isbn13: "9780000000002", ids: { hardcover: 77 } });
    const library = buildLibraryIndex([{ title: "Completely Other Name", authors: ["Zed"], isbn13: "9780000000002", copyIsbns: [], hardcoverId: null }]);
    const d = deps({ rounds: [result([raw("Title A")]), result([])], search: catalogue([withIsbn]), inLibrary: (c) => inLibrary(library, c) });
    const set = await buildPickSet({ scope: "personal", target: 1, deps: d });
    expect(set.items).toEqual([]);
    expect(set.dropped.inLibrary).toBe(1);
  });

  it("tops up once with the dropped titles excluded when too few remain", async () => {
    const d = deps({ rounds: [result([raw("Title A"), raw("Nope One"), raw("Nope Two")]), result([raw("Title B"), raw("Title C")], { inputTokens: 1200, outputTokens: 300 })], search: catalogue(known) });
    const set = await buildPickSet({ scope: "personal", target: 3, deps: d });
    expect(d.request).toHaveBeenCalledTimes(2);
    expect(set.calls).toBe(2);
    expect(set.items.map((i) => i.title)).toEqual(["Title A", "Title B", "Title C"]);
    expect(set.usage).toEqual({ inputTokens: 2200, outputTokens: 700 });
    const second = d.request.mock.calls[1][0] as { user: string };
    expect(second.user).toContain("Nope One");
    expect(second.user).toContain("Nope Two");
    expect(second.user).toContain("Title A"); // do not repeat what was kept either
    expect(second.user).toContain("Give 5 different books"); // 3 - 1 kept + margin 3
  });

  it("never makes more than two model calls", async () => {
    const d = deps({ rounds: [result([raw("Nope 1")]), result([raw("Nope 2")]), result([raw("Title A")])], search: catalogue(known) });
    const set = await buildPickSet({ scope: "personal", target: 3, deps: d });
    expect(d.request).toHaveBeenCalledTimes(2);
    expect(set.items).toEqual([]);
  });

  it("keeps the first round when the top-up fails, and counts the failed call's tokens", async () => {
    const failing = async (): Promise<RecommendResult> => {
      throw new RecommendError("busy", "Busy.", { inputTokens: 900, outputTokens: 0 });
    };
    const d = deps({ rounds: [result([raw("Title A")]), failing], search: catalogue(known) });
    const set = await buildPickSet({ scope: "personal", target: 3, deps: d });
    expect(set.items.map((i) => i.title)).toEqual(["Title A"]);
    expect(set.topUpError).toBe("Busy.");
    expect(set.usage).toEqual({ inputTokens: 1900, outputTokens: 400 });
  });

  it("throws when the first call fails (nothing was produced)", async () => {
    const d = deps({ rounds: [async () => { throw new RecommendError("refused", "No.", { inputTokens: 5, outputTokens: 1 }); }] });
    await expect(buildPickSet({ scope: "personal", target: 3, deps: d })).rejects.toMatchObject({ kind: "refused" });
  });

  it("trims a long description before storing", async () => {
    const long = meta("Title A", "Some Author", { description: "x".repeat(2000) });
    const d = deps({ rounds: [result([raw("Title A")])], search: async () => [long] });
    const set = await buildPickSet({ scope: "personal", target: 1, deps: d });
    expect(set.items[0].book.description!.length).toBeLessThanOrEqual(600);
  });
});
