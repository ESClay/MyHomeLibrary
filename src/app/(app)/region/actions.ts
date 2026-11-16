"use server";

import { revalidatePath } from "next/cache";
import { isLocale, isRegionId, getRegion, localeForRegion } from "@/lib/regions";
import { requireUser } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "../actions";

/**
 * Saves the signed-in person's region and locale (the one-time "Choose your region" step, and Settings).
 * RLS lets people update only their own profile. When this is the first time they have a region, any library they own that has no
 * price region yet starts pricing in it, so existing libraries are filled the moment their owner chooses. A library that already has
 * a price region is never touched here: changing that is a separate, confirmed action in Settings.
 */
export async function saveRegion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const regionId = String(formData.get("region") ?? "");
  const region = getRegion(regionId);
  if (!region || !isRegionId(regionId)) return { error: "Choose your region from the list." };

  const rawLocale = String(formData.get("locale") ?? "");
  const locale = isLocale(rawLocale) ? rawLocale : localeForRegion(region, null);

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ region: region.id, locale }).eq("id", user.id);
  if (error) return { error: error.message };

  await supabase.from("libraries").update({ price_region: region.id }).eq("owner_id", user.id).is("price_region", null);

  revalidatePath("/", "layout");
  return {};
}
