/** Pure pricing helpers: no network, no environment. The eBay client (ebay.ts) and the tests both build on these. */
import type { Condition, Format } from "@/lib/books/constants";

/** Formats we price: only physical books have a secondhand market on eBay. */
export const PHYSICAL_FORMATS: readonly Format[] = ["hardcover", "paperback"];

export function isPhysicalFormat(format: string): boolean {
  return (PHYSICAL_FORMATS as readonly string[]).includes(format);
}

/** Our condition enum to eBay's numeric condition ids (New 1000, Like New 2750, Very Good 4000, Good 5000, Acceptable 6000). */
export const CONDITION_TO_EBAY: Record<Condition, number> = {
  new: 1000,
  like_new: 2750,
  very_good: 4000,
  good: 5000,
  acceptable: 6000,
};

export function ebayConditionId(condition: Condition | null | undefined): number | null {
  return condition ? (CONDITION_TO_EBAY[condition] ?? null) : null;
}

/** Fewer listings than this and a condition-matched price is not trusted, so the search widens. */
export const MIN_LISTINGS = 3;

export type Listing = { price: string | number; currency: string; fixedPrice: boolean };

/** The middle value; the mean of the two middle values for an even count; null for none. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The listings that count: fixed price (Buy It Now), in the marketplace's own currency, with a sane price.
 * Item price only; shipping is never added.
 */
export function usablePrices(listings: Listing[], currency: string): number[] {
  const out: number[] = [];
  for (const l of listings) {
    if (!l.fixedPrice || l.currency !== currency) continue;
    const n = typeof l.price === "number" ? l.price : Number(l.price);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** Rounds to cents so the stored numeric(10,2) matches what we show. */
export const toCents = (n: number) => Math.round(n * 100) / 100;
