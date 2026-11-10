"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CURRENT_LIBRARY_COOKIE } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();
  const { data: libraryId, error } = await supabase.rpc("accept_invite", { invite_token: token });

  if (error || !libraryId) {
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(error?.message ?? "Invite failed")}`);
  }

  (await cookies()).set(CURRENT_LIBRARY_COOKIE, libraryId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  redirect("/library");
}
