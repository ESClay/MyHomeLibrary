"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/library";
import { getRegion } from "@/lib/regions";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "../actions";

// All writes below rely on RLS: only a library owner can change these rows.

export async function renameLibrary(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const supabase = await createClient();
  await supabase.from("libraries").update({ name }).eq("id", String(formData.get("libraryId")));
  revalidatePath("/", "layout");
}

export async function createInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "viewer");
  if (!email) return { error: "Enter an email address." };
  if (role !== "editor" && role !== "viewer") return { error: "Invalid role." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("library_invites")
    .insert({ library_id: String(formData.get("libraryId")), email, role });
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}

export async function revokeInvite(formData: FormData) {
  await requireUser();
  const supabase = await createClient();
  await supabase.from("library_invites").delete().eq("id", String(formData.get("inviteId")));
  revalidatePath("/settings");
}

export async function removeMember(formData: FormData) {
  await requireUser();
  const supabase = await createClient();
  await supabase
    .from("library_members")
    .delete()
    .eq("library_id", String(formData.get("libraryId")))
    .eq("user_id", String(formData.get("userId")));
  revalidatePath("/settings");
}

/**
 * Owner only (RLS): changes the marketplace, and so the currency, the library's prices use. Existing prices stay on the copies in
 * their old currency, flagged as such, until the next price check replaces them. Nothing is deleted.
 */
export async function changePriceRegion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const libraryId = String(formData.get("libraryId") ?? "");
  const region = getRegion(String(formData.get("priceRegion") ?? ""));
  if (!region) return { error: "Choose a region from the list." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("libraries").update({ price_region: region.id }).eq("id", libraryId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only the library owner can change its price region." };

  revalidatePath("/", "layout");
  return {};
}
