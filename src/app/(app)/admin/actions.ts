"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAppAdmin } from "@/lib/access";
import { fail, firstIssue, type ActionResult } from "@/lib/books/access";
import { requireUser } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";

const input = z.object({ userId: z.string().uuid(), enabled: z.boolean() });

/** Turns full access on or off for one account. Admins only: checked here and again inside the set_full_access function. */
export async function setFullAccess(raw: z.input<typeof input>): Promise<ActionResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const user = await requireUser();
  const supabase = await createClient();
  if (!(await isAppAdmin(supabase, user.id))) return fail("Only an app admin can change access.");

  const { error } = await supabase.rpc("set_full_access", { target: parsed.data.userId, enabled: parsed.data.enabled });
  if (error) return fail(error.code === "42501" ? "Only an app admin can change access." : "Could not change access. Try again.");
  revalidatePath("/admin");
  return { ok: true };
}
