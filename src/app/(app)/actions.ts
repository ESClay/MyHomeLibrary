"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CURRENT_LIBRARY_COOKIE, requireUser } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; saved?: boolean };

async function setCurrentLibrary(id: string) {
  (await cookies()).set(CURRENT_LIBRARY_COOKIE, id, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}

export async function createLibrary(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give your library a name." };

  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("libraries").insert({ name }).select("id").single();
  if (error) return { error: error.message };

  await setCurrentLibrary(data.id);
  revalidatePath("/", "layout");
  redirect("/library");
}

export async function switchLibrary(libraryId: string) {
  const user = await requireUser();
  const supabase = await createClient();
  // RLS limits this to libraries the user belongs to.
  const { data } = await supabase
    .from("library_members")
    .select("library_id")
    .eq("library_id", libraryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return;

  await setCurrentLibrary(libraryId);
  revalidatePath("/", "layout");
}
