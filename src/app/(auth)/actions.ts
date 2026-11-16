"use server";

import { redirect } from "next/navigation";
import { getOrigin } from "@/lib/origin";
import { getRegion, isLocale, localeForRegion } from "@/lib/regions";
import { safeNext } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string };

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { error: error.message };

  redirect(safeNext(String(formData.get("next") ?? "")));
}

function regionMeta(formData: FormData): { region?: string; locale?: string } {
  const region = getRegion(String(formData.get("region") ?? ""));
  if (!region) return {};
  const raw = String(formData.get("locale") ?? "");
  return { region: region.id, locale: isLocale(raw) ? raw : localeForRegion(region, null) };
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const next = safeNext(String(formData.get("next") ?? ""));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    options: {
      // The profile trigger copies region and locale from this metadata, so it also works when email confirmation delays the session.
      data: { full_name: String(formData.get("name") ?? "").trim() || undefined, ...regionMeta(formData) },
      emailRedirectTo: `${await getOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message };

  // With email confirmation enabled there is no session yet.
  if (!data.session) return { message: "Check your email to confirm your account, then sign in." };
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
