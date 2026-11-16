import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceResult } from "./ebay";

type Priced = Extract<PriceResult, { status: "priced" }>;

/** Stores a fresh price on the copy and appends it to the history. Works with the user's client (RLS) or the service role. */
export async function recordPrice(db: SupabaseClient, copyId: string, res: Priced, at: Date = new Date()): Promise<void> {
  const checkedAt = at.toISOString();
  const { error } = await db
    .from("copies")
    .update({
      current_price: res.price,
      current_price_currency: res.currency,
      price_checked_at: checkedAt,
      price_source: "ebay",
      price_approximate: res.approximate,
      price_listing_count: res.listingCount,
    })
    .eq("id", copyId);
  if (error) throw new Error(`copies: ${error.message}`);
  const { error: histError } = await db.from("price_history").insert({
    copy_id: copyId,
    price: res.price,
    currency: res.currency,
    source: "ebay",
    approximate: res.approximate,
    listing_count: res.listingCount,
    checked_at: checkedAt,
  });
  if (histError) throw new Error(`price_history: ${histError.message}`);
}

/** Records that we looked and found nothing: the last price is cleared, the time is kept, so the daily job moves on. */
export async function recordNoPrice(db: SupabaseClient, copyId: string, at: Date = new Date()): Promise<void> {
  const { error } = await db
    .from("copies")
    .update({
      current_price: null,
      current_price_currency: null,
      price_checked_at: at.toISOString(),
      price_source: "ebay",
      price_approximate: false,
      price_listing_count: 0,
    })
    .eq("id", copyId);
  if (error) throw new Error(`copies: ${error.message}`);
}
