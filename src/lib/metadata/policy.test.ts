import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyMetadata } from "./util";
import type { BookMetadata, MetadataProvider, ProviderName } from "./types";

const make = (name: ProviderName, configured = true) => {
  const book = (q: string): BookMetadata => ({ ...emptyMetadata(name), title: `${q} via ${name}`, isbn13: "9780441172719", authors: ["A"] });
  const lookups = vi.fn<(isbn: string) => Promise<BookMetadata | null>>(async (isbn) => book(isbn));
  const searches = vi.fn<(q: string) => Promise<BookMetadata[]>>(async (q) => [book(q)]);
  const provider: MetadataProvider = { name, isConfigured: () => configured, lookupByIsbn: lookups, search: searches };
  return Object.assign(provider, { lookups, searches });
};

type Fake = ReturnType<typeof make>;
let hc: Fake;
let gb: Fake;
let ol: Fake;

async function load() {
  vi.resetModules();
  hc = make("hardcover");
  gb = make("google");
  ol = make("openlibrary");
  // Fresh fakes for every test, installed before the module under test is imported.
  vi.doMock("./hardcover", () => ({ hardcover: hc }));
  vi.doMock("./googleBooks", () => ({ googleBooks: gb }));
  vi.doMock("./openLibrary", () => ({ openLibrary: ol }));
  return import("./index");
}

beforeEach(() => vi.clearAllMocks());

describe("provider policy", () => {
  it("providersFor: everything with full access, Open Library only without", async () => {
    const { providersFor, ALL_PROVIDERS, OPEN_PROVIDERS } = await load();
    expect(providersFor(true)).toBe(ALL_PROVIDERS);
    expect(providersFor(false)).toBe(OPEN_PROVIDERS);
    expect(OPEN_PROVIDERS.providers).toEqual(["openlibrary"]);
  });

  it("an open-only search never touches Hardcover or Google", async () => {
    const { search, OPEN_PROVIDERS } = await load();
    const out = await search("dune", OPEN_PROVIDERS);
    expect(out.map((b) => b.providers)).toEqual([["openlibrary"]]);
    expect(hc.searches).not.toHaveBeenCalled();
    expect(gb.searches).not.toHaveBeenCalled();
    expect(ol.searches).toHaveBeenCalledTimes(1);
  });

  it("an open-only ISBN lookup never touches Hardcover or Google", async () => {
    const { lookupByIsbn, OPEN_PROVIDERS } = await load();
    const out = await lookupByIsbn("9780441172719", OPEN_PROVIDERS);
    expect(out?.providers).toEqual(["openlibrary"]);
    expect(hc.lookups).not.toHaveBeenCalled();
    expect(gb.lookups).not.toHaveBeenCalled();
  });

  it("an ISBN-looking search is routed through the same policy", async () => {
    const { search, OPEN_PROVIDERS } = await load();
    await search("9780441172719", OPEN_PROVIDERS);
    expect(hc.lookups).not.toHaveBeenCalled();
    expect(ol.lookups).toHaveBeenCalled();
  });

  it("refreshFor honours the policy too", async () => {
    const { refreshFor, OPEN_PROVIDERS } = await load();
    await refreshFor({ title: "Dune", authors: ["A"], isbn13: null }, OPEN_PROVIDERS);
    expect(hc.searches).not.toHaveBeenCalled();
    expect(gb.searches).not.toHaveBeenCalled();
  });

  it("the full policy queries every configured provider", async () => {
    const { search, ALL_PROVIDERS } = await load();
    await search("dune", ALL_PROVIDERS);
    expect(hc.searches).toHaveBeenCalledTimes(1);
    expect(gb.searches).toHaveBeenCalledTimes(1);
    expect(ol.searches).toHaveBeenCalledTimes(1);
  });

  it("an empty policy queries nothing", async () => {
    const { search, lookupByIsbn } = await load();
    expect(await search("dune", { providers: [] })).toEqual([]);
    expect(await lookupByIsbn("9780441172719", { providers: [] })).toBeNull();
    expect(ol.searches).not.toHaveBeenCalled();
  });
});

describe("merged-result cache is keyed by provider set", () => {
  it("builds different keys for different provider sets, and the same key whatever the order", async () => {
    const { resultKey, ALL_PROVIDERS, OPEN_PROVIDERS } = await load();
    expect(resultKey("search", ALL_PROVIDERS, "dune")).not.toBe(resultKey("search", OPEN_PROVIDERS, "dune"));
    expect(resultKey("search", { providers: ["google", "openlibrary"] }, "dune")).toBe(resultKey("search", { providers: ["openlibrary", "google"] }, "dune"));
    expect(resultKey("isbn", ALL_PROVIDERS, "9780441172719")).not.toBe(resultKey("search", ALL_PROVIDERS, "9780441172719"));
  });

  it("a Hardcover result cached for a granted search is not served to an ungranted one", async () => {
    const { search, ALL_PROVIDERS, OPEN_PROVIDERS } = await load();
    const full = await search("dune", ALL_PROVIDERS);
    expect(full[0].providers).toContain("hardcover");
    const open = await search("dune", OPEN_PROVIDERS);
    expect(open.flatMap((b) => b.providers)).toEqual(["openlibrary"]);
    expect(hc.searches).toHaveBeenCalledTimes(1);
    expect(ol.searches).toHaveBeenCalledTimes(2); // once for each provider set: the open-only request was not answered from the full cache
  });

  it("the same provider set is served from the cache", async () => {
    const { search, OPEN_PROVIDERS } = await load();
    await search("Dune", OPEN_PROVIDERS);
    await search("dune", OPEN_PROVIDERS);
    expect(ol.searches).toHaveBeenCalledTimes(1);
  });

  it("an ISBN lookup is cached per provider set as well", async () => {
    const { lookupByIsbn, ALL_PROVIDERS, OPEN_PROVIDERS } = await load();
    const full = await lookupByIsbn("9780441172719", ALL_PROVIDERS);
    const open = await lookupByIsbn("9780441172719", OPEN_PROVIDERS);
    expect(full?.providers).toContain("hardcover");
    expect(open?.providers).toEqual(["openlibrary"]);
  });
});
