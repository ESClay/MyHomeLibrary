import "server-only";
import type { Condition } from "@/lib/books/constants";
import { currencyFor } from "@/lib/regions";
import { MIN_LISTINGS, ebayConditionId, isPhysicalFormat, median, toCents, usablePrices, type Listing } from "./compute";

/*
 * eBay Browse API pricing. Sources (eBay Developers Program):
 *  - OAuth client-credentials grant: POST https://api.ebay.com/identity/v1/oauth2/token, `Authorization: Basic base64(id:secret)`,
 *    form body `grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope`; the answer carries `access_token` and
 *    `expires_in` (seconds). https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html
 *  - Search: GET https://api.ebay.com/buy/browse/v1/item_summary/search with the `gtin` parameter (UPC, EAN or ISBN), the `filter`
 *    parameter (`buyingOptions:{FIXED_PRICE}`, `conditionIds:{4000}`), and the required header `X-EBAY-C-MARKETPLACE-ID`.
 *    https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
 *    https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html
 *  - Marketplace ids: https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html
 * The `priceCurrency` filter is only needed together with a `price` range filter, so instead of sending it we ignore any listing whose
 * currency is not the marketplace's.
 */

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";
const PAGE_LIMIT = 50;
/** Renew a token this long before it expires. */
const TOKEN_SKEW_MS = 60_000;

export type EbayErrorKind = "config" | "auth" | "rate_limited" | "no_result" | "http";

export class EbayError extends Error {
  constructor(
    readonly kind: EbayErrorKind,
    message: string,
    readonly status?: number,
    /** Seconds to wait, when eBay said. */
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "EbayError";
  }
}

export type PriceRequest = {
  /** The copy's edition ISBN, else the book's ISBN-13. */
  isbn: string | null | undefined;
  format: string;
  condition: Condition | null | undefined;
  /** eBay marketplace id, e.g. EBAY_CA. */
  marketplace: string;
};

export type PriceResult =
  | { status: "priced"; price: number; currency: string; approximate: boolean; listingCount: number; calls: number }
  | { status: "not_priced"; reason: "format" | "isbn"; calls: 0 };

export type EbayDeps = {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => number;
};

type SearchBody = {
  itemSummaries?: { price?: { value?: string; currency?: string }; buyingOptions?: string[] }[];
};

export type EbayClient = {
  price(req: PriceRequest): Promise<PriceResult>;
  /** Drops the cached token (tests, and after a 401). */
  clearToken(): void;
};

export function createEbayClient(deps: EbayDeps = {}): EbayClient {
  const doFetch = deps.fetch ?? fetch;
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  let token: { value: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function mintToken(): Promise<string> {
    const id = env.EBAY_CLIENT_ID;
    const secret = env.EBAY_CLIENT_SECRET;
    if (!id || !secret) throw new EbayError("config", "eBay is not configured (EBAY_CLIENT_ID and EBAY_CLIENT_SECRET).");
    const res = await doFetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }).toString(),
    });
    if (res.status === 429) throw new EbayError("rate_limited", "eBay token requests are rate limited.", 429, retryAfter(res));
    if (!res.ok) throw new EbayError("auth", `eBay rejected the keys (token request ${res.status}).`, res.status);
    const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!body?.access_token) throw new EbayError("auth", "eBay's token answer had no access token.", res.status);
    const ttlMs = Math.max(0, Number(body.expires_in ?? 7200) * 1000);
    token = { value: body.access_token, expiresAt: now() + ttlMs - TOKEN_SKEW_MS };
    return token.value;
  }

  async function getToken(): Promise<string> {
    if (token && now() < token.expiresAt) return token.value;
    // One mint at a time, however many searches are waiting on it.
    inflight ??= mintToken().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function search(gtin: string, marketplace: string, conditionId: number | null): Promise<Listing[]> {
    const filters = ["buyingOptions:{FIXED_PRICE}"];
    if (conditionId) filters.push(`conditionIds:{${conditionId}}`);
    const url = `${SEARCH_URL}?${new URLSearchParams({ gtin, filter: filters.join(","), limit: String(PAGE_LIMIT) }).toString()}`;

    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url, {
        headers: { Authorization: `Bearer ${await getToken()}`, "X-EBAY-C-MARKETPLACE-ID": marketplace, Accept: "application/json" },
      });
      if (res.status === 401 && attempt === 0) {
        // The token expired or was revoked early: mint a fresh one and try once more.
        token = null;
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new EbayError("auth", `eBay refused the request (${res.status}).`, res.status);
      if (res.status === 429) throw new EbayError("rate_limited", "eBay says the call limit is reached.", 429, retryAfter(res));
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { errors?: { errorId?: number; message?: string }[] } | null;
        // 2001 is eBay's "request limit reached" error id.
        if (body?.errors?.some((e) => e.errorId === 2001)) throw new EbayError("rate_limited", "eBay says the call limit is reached.", res.status);
        throw new EbayError("http", `eBay search failed (${res.status})${body?.errors?.[0]?.message ? `: ${body.errors[0].message}` : ""}.`, res.status);
      }
      const body = (await res.json().catch(() => null)) as SearchBody | null;
      return (body?.itemSummaries ?? []).map((i) => ({
        price: i.price?.value ?? "",
        currency: i.price?.currency ?? "",
        fixedPrice: (i.buyingOptions ?? []).includes("FIXED_PRICE"),
      }));
    }
  }

  return {
    clearToken() {
      token = null;
    },
    async price(req) {
      if (!isPhysicalFormat(req.format)) return { status: "not_priced", reason: "format", calls: 0 };
      const gtin = (req.isbn ?? "").replace(/[\s-]/g, "");
      if (!/^\d{10}$|^\d{13}$/.test(gtin)) return { status: "not_priced", reason: "isbn", calls: 0 };
      const currency = currencyFor(req.marketplace);
      if (!currency) throw new EbayError("config", `Unknown eBay marketplace ${req.marketplace}.`);

      let calls = 0;
      const conditionId = ebayConditionId(req.condition);

      if (conditionId) {
        calls++;
        const matched = usablePrices(await search(gtin, req.marketplace, conditionId), currency);
        if (matched.length >= MIN_LISTINGS) {
          return { status: "priced", price: toCents(median(matched)!), currency, approximate: false, listingCount: matched.length, calls };
        }
      }

      // Too few listings in this condition (or the copy has none set): widen to every condition and say so.
      calls++;
      const widened = usablePrices(await search(gtin, req.marketplace, null), currency);
      if (widened.length === 0) throw new EbayError("no_result", "No fixed-price listings found for this ISBN.");
      return { status: "priced", price: toCents(median(widened)!), currency, approximate: true, listingCount: widened.length, calls };
    },
  };
}

function retryAfter(res: Response): number | undefined {
  const n = Number(res.headers.get("retry-after"));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function ebayConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.EBAY_CLIENT_ID && !!env.EBAY_CLIENT_SECRET;
}

let shared: EbayClient | null = null;
/** The process-wide client: its token survives between requests on a warm server. */
export function getEbayClient(): EbayClient {
  shared ??= createEbayClient();
  return shared;
}
