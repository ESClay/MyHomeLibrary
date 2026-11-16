"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fullAccessDenied, hasFullAccess } from "@/lib/access";
import { authorizeBook, fail, type ActionResult } from "@/lib/books/access";
import type { Condition } from "@/lib/books/constants";
import { EbayError, ebayConfigured, getEbayClient } from "@/lib/pricing/ebay";
import { PRICE_CHECK_DAILY_CAP, checksLeft } from "@/lib/pricing/limits";
import { recordNoPrice, recordPrice } from "@/lib/pricing/record";
import { getRegion } from "@/lib/regions";
import { requireUser } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";

/** Looks up one copy's market price on eBay now. Editors and owners; at most PRICE_CHECK_DAILY_CAP checks per person per 24 hours. */
export async function checkCopyPrice(copyId: string): Promise<ActionResult<{ message: string; left: number }>> {
  const parsed = z.string().uuid().safeParse(copyId);
  if (!parsed.success) return fail("That copy id is not valid.");
  const user = await requireUser();
  const supabase = await createClient();
  // eBay checks are quota-limited: full access only.
  if (!(await hasFullAccess(supabase, user.id))) return fullAccessDenied();

  const { data: copy } = await supabase.from("copies").select("id, book_id, format, condition, edition_isbn").eq("id", parsed.data).maybeSingle();
  if (!copy) return fail("That copy does not exist.");
  const auth = await authorizeBook(copy.book_id as string, true);
  if (!auth.ok) return fail(auth.error);

  const { data: library } = await supabase.from("libraries").select("price_region").eq("id", auth.book.library_id).maybeSingle();
  const region = getRegion(library?.price_region as string | null | undefined);
  if (!region) return fail("Choose a price region in Settings first. Prices are off until then.");
  if (!ebayConfigured()) return fail("Price checks are not set up yet: the eBay keys are missing on the server.");

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase.from("price_check_log").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("checked_at", since);
  const left = checksLeft(count ?? 0);
  if (left === 0) return fail(`You have used today's ${PRICE_CHECK_DAILY_CAP} price checks. Try again tomorrow.`);
  await supabase.from("price_check_log").insert({ user_id: user.id, copy_id: copy.id });

  const done = (message: string): ActionResult<{ message: string; left: number }> => {
    revalidatePath(`/books/${copy.book_id}`);
    return { ok: true, message, left: left - 1 };
  };

  try {
    const res = await getEbayClient().price({
      isbn: (copy.edition_isbn as string | null) || auth.book.isbn13,
      format: copy.format as string,
      condition: copy.condition as Condition | null,
      marketplace: region.id,
    });
    if (res.status === "not_priced") {
      return fail(res.reason === "format" ? "Only hardcovers and paperbacks are priced." : "This copy needs an ISBN to be priced.");
    }
    await recordPrice(supabase, copy.id as string, res);
    return done(res.approximate ? "Priced from similar copies, so treat it as approximate." : "Price updated.");
  } catch (e) {
    if (e instanceof EbayError) {
      if (e.kind === "no_result") {
        await recordNoPrice(supabase, copy.id as string);
        return done(`No price found: nobody is listing this ISBN on ${region.domain} right now.`);
      }
      if (e.kind === "rate_limited") return fail("eBay is busy right now. Try again in a while.");
      if (e.kind === "config") return fail("Price checks are not set up yet.");
      return fail("eBay would not answer. Try again later.");
    }
    return fail(e instanceof Error ? e.message : "The price check failed.");
  }
}
