"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/library";
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
