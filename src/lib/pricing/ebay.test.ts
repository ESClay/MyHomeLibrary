import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CONDITION_TO_EBAY, PHYSICAL_FORMATS, ebayConditionId, isPhysicalFormat, median, usablePrices } from "./compute";
import { EbayError, createEbayClient, ebayConfigured } from "./ebay";
import { PRICE_CHECK_DAILY_CAP, checksLeft } from "./limits";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8"));
const TOKEN = fixture("ebay-token.json");
const FIVE = fixture("ebay-search-ca.json");
const TWO = fixture("ebay-search-two.json");
const EMPTY = fixture("ebay-search-empty.json");
const LIMITED = fixture("ebay-error-ratelimit.json");

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const ENV = { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" };

/** A fake eBay: answers the token endpoint and routes searches through `onSearch`. */
function fakeEbay(onSearch: (url: URL, headers: Headers, n: number) => Response | Promise<Response>) {
  let searches = 0;
  let tokens = 0;
  const calls: { url: URL; headers: Headers }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.pathname === "/identity/v1/oauth2/token") {
      tokens++;
      return json({ ...TOKEN, access_token: `token-${tokens}` });
    }
    searches++;
    calls.push({ url, headers });
    return onSearch(url, headers, searches);
  });
  return { fetch: fn as unknown as typeof fetch, fn, calls, get tokens() { return tokens; }, get searches() { return searches; } };
}

const book = { isbn: "9780441172719", format: "paperback", condition: "very_good" as const, marketplace: "EBAY_CA" };

describe("condition mapping and scoping", () => {
  it("maps our condition names to eBay's ids", () => {
    expect(CONDITION_TO_EBAY).toEqual({ new: 1000, like_new: 2750, very_good: 4000, good: 5000, acceptable: 6000 });
    expect(ebayConditionId("good")).toBe(5000);
    expect(ebayConditionId(null)).toBeNull();
  });

  it("prices only hardcovers and paperbacks", () => {
    expect([...PHYSICAL_FORMATS]).toEqual(["hardcover", "paperback"]);
    expect(isPhysicalFormat("hardcover")).toBe(true);
    expect(isPhysicalFormat("ebook")).toBe(false);
    expect(isPhysicalFormat("audiobook")).toBe(false);
  });
});

describe("median", () => {
  it("takes the middle, or the mean of the middle two", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("counts only fixed-price listings in the marketplace currency, ignoring shipping", () => {
    const listings = FIVE.itemSummaries.map((i: { price: { value: string; currency: string }; buyingOptions: string[] }) => ({
      price: i.price.value,
      currency: i.price.currency,
      fixedPrice: i.buyingOptions.includes("FIXED_PRICE"),
    }));
    expect(usablePrices(listings, "CAD")).toEqual([9.5, 12, 8]);
    expect(usablePrices(listings, "USD")).toEqual([6]);
  });

  it("drops junk prices", () => {
    expect(usablePrices([{ price: "abc", currency: "CAD", fixedPrice: true }, { price: 0, currency: "CAD", fixedPrice: true }, { price: "3", currency: "CAD", fixedPrice: true }], "CAD")).toEqual([3]);
  });
});

describe("eBay client", () => {
  it("authenticates with client credentials and the public scope, then searches by gtin with the marketplace header", async () => {
    const f = fakeEbay(() => json(FIVE));
    const client = createEbayClient({ fetch: f.fetch, env: ENV });
    await client.price(book);

    const [tokenUrl, tokenInit] = f.fn.mock.calls[0];
    expect(String(tokenUrl)).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    const h = new Headers((tokenInit as RequestInit).headers);
    expect(h.get("authorization")).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    expect(h.get("content-type")).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String((tokenInit as RequestInit).body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("https://api.ebay.com/oauth/api_scope");

    const { url, headers } = f.calls[0];
    expect(url.origin + url.pathname).toBe("https://api.ebay.com/buy/browse/v1/item_summary/search");
    expect(url.searchParams.get("gtin")).toBe("9780441172719");
    expect(url.searchParams.get("filter")).toBe("buyingOptions:{FIXED_PRICE},conditionIds:{4000}");
    expect(headers.get("x-ebay-c-marketplace-id")).toBe("EBAY_CA");
    expect(headers.get("authorization")).toBe("Bearer token-1");
  });

  it("returns the median item price of matching fixed-price listings in the marketplace currency", async () => {
    const f = fakeEbay(() => json(FIVE));
    const res = await createEbayClient({ fetch: f.fetch, env: ENV }).price(book);
    // 9.50, 12.00 and 8.00 count; USD and auction listings do not; shipping is ignored.
    expect(res).toEqual({ status: "priced", price: 9.5, currency: "CAD", approximate: false, listingCount: 3, calls: 1 });
    expect(f.searches).toBe(1);
  });

  it("widens to every condition with fewer than 3 listings and flags the result as approximate", async () => {
    const f = fakeEbay((url) => (url.searchParams.get("filter")!.includes("conditionIds") ? json(TWO) : json(FIVE)));
    const res = await createEbayClient({ fetch: f.fetch, env: ENV }).price({ ...book, condition: "like_new" });
    expect(f.searches).toBe(2);
    expect(f.calls[0].url.searchParams.get("filter")).toContain("conditionIds:{2750}");
    expect(f.calls[1].url.searchParams.get("filter")).toBe("buyingOptions:{FIXED_PRICE}");
    expect(res).toMatchObject({ status: "priced", price: 9.5, approximate: true, listingCount: 3, calls: 2 });
  });

  it("makes one unfiltered, approximate search when the copy has no condition", async () => {
    const f = fakeEbay(() => json(FIVE));
    const res = await createEbayClient({ fetch: f.fetch, env: ENV }).price({ ...book, condition: null });
    expect(f.searches).toBe(1);
    expect(res).toMatchObject({ status: "priced", approximate: true, calls: 1 });
  });

  it("reports no result when even the widened search finds nothing, with no keyword fallback", async () => {
    const f = fakeEbay(() => json(EMPTY));
    await expect(createEbayClient({ fetch: f.fetch, env: ENV }).price(book)).rejects.toMatchObject({ kind: "no_result" });
    expect(f.searches).toBe(2);
    expect(f.calls.every((c) => c.url.searchParams.has("gtin") && !c.url.searchParams.has("q"))).toBe(true);
  });

  it("does not price ebooks, audiobooks or copies without an ISBN, and makes no call", async () => {
    const f = fakeEbay(() => json(FIVE));
    const client = createEbayClient({ fetch: f.fetch, env: ENV });
    expect(await client.price({ ...book, format: "ebook" })).toEqual({ status: "not_priced", reason: "format", calls: 0 });
    expect(await client.price({ ...book, format: "audiobook" })).toEqual({ status: "not_priced", reason: "format", calls: 0 });
    expect(await client.price({ ...book, isbn: null })).toEqual({ status: "not_priced", reason: "isbn", calls: 0 });
    expect(await client.price({ ...book, isbn: "12345" })).toEqual({ status: "not_priced", reason: "isbn", calls: 0 });
    expect(f.fn).not.toHaveBeenCalled();
  });

  it("caches the token until it expires", async () => {
    let t = 1_000_000;
    const f = fakeEbay(() => json(FIVE));
    const client = createEbayClient({ fetch: f.fetch, env: ENV, now: () => t });
    await client.price(book);
    await client.price(book);
    expect(f.tokens).toBe(1);
    t += 7200 * 1000; // expires_in 7200 s, less the renewal margin
    await client.price(book);
    expect(f.tokens).toBe(2);
  });

  it("mints one token for searches that start together", async () => {
    const f = fakeEbay(() => json(FIVE));
    const client = createEbayClient({ fetch: f.fetch, env: ENV });
    await Promise.all([client.price(book), client.price(book), client.price(book)]);
    expect(f.tokens).toBe(1);
  });

  it("refreshes the token once on a 401 and retries", async () => {
    const f = fakeEbay((_u, headers, n) => (n === 1 ? json({ errors: [{ errorId: 1001 }] }, 401) : json(FIVE)));
    const res = await createEbayClient({ fetch: f.fetch, env: ENV }).price(book);
    expect(res.status).toBe("priced");
    expect(f.tokens).toBe(2);
    expect(f.calls[1].headers.get("authorization")).toBe("Bearer token-2");
  });

  it("gives up with an auth error after a second 401", async () => {
    const f = fakeEbay(() => json({}, 401));
    await expect(createEbayClient({ fetch: f.fetch, env: ENV }).price(book)).rejects.toMatchObject({ kind: "auth" });
    expect(f.searches).toBe(2);
  });

  it("raises typed errors for missing config, bad keys and rate limits", async () => {
    await expect(createEbayClient({ fetch: fakeEbay(() => json(FIVE)).fetch, env: {} }).price(book)).rejects.toMatchObject({ kind: "config" });

    const badKeys = vi.fn(async () => json({ error: "invalid_client" }, 401)) as unknown as typeof fetch;
    await expect(createEbayClient({ fetch: badKeys, env: ENV }).price(book)).rejects.toMatchObject({ kind: "auth" });

    const limited = fakeEbay(() => json(LIMITED, 429, { "retry-after": "60" }));
    const err = await createEbayClient({ fetch: limited.fetch, env: ENV }).price(book).catch((e) => e);
    expect(err).toBeInstanceOf(EbayError);
    expect(err).toMatchObject({ kind: "rate_limited", retryAfterSec: 60 });

    const byId = fakeEbay(() => json(LIMITED, 500));
    await expect(createEbayClient({ fetch: byId.fetch, env: ENV }).price(book)).rejects.toMatchObject({ kind: "rate_limited" });

    const down = fakeEbay(() => json({}, 503));
    await expect(createEbayClient({ fetch: down.fetch, env: ENV }).price(book)).rejects.toMatchObject({ kind: "http", status: 503 });
  });

  it("rejects a marketplace we do not know", async () => {
    const f = fakeEbay(() => json(FIVE));
    await expect(createEbayClient({ fetch: f.fetch, env: ENV }).price({ ...book, marketplace: "EBAY_XX" })).rejects.toMatchObject({ kind: "config" });
  });

  it("knows when eBay is configured", () => {
    expect(ebayConfigured(ENV)).toBe(true);
    expect(ebayConfigured({ EBAY_CLIENT_ID: "x" })).toBe(false);
  });
});

describe("on-demand cap", () => {
  it("allows 30 checks per person per day", () => {
    expect(PRICE_CHECK_DAILY_CAP).toBe(30);
    expect(checksLeft(0)).toBe(30);
    expect(checksLeft(12)).toBe(18);
    expect(checksLeft(45)).toBe(0);
  });
});
