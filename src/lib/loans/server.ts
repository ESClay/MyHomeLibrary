import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dueDateToTimestamp } from "./rules";
import type { BorrowerChoice } from "./schemas";

/** Turns "pick a person or add a new one" into a borrower id, creating the borrower when needed. */
export async function resolveBorrower(
  db: SupabaseClient,
  libraryId: string,
  who: BorrowerChoice,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (who.borrowerId) {
    const { data } = await db.from("borrowers").select("id").eq("id", who.borrowerId).eq("library_id", libraryId).maybeSingle();
    return data ? { ok: true, id: data.id as string } : { ok: false, error: "That person is not in this library's list." };
  }
  const name = who.newName ?? "";
  const { data, error } = await db.from("borrowers").insert({ library_id: libraryId, name, note: who.newNote || null }).select("id").single();
  if (data) return { ok: true, id: data.id as string };
  // The same name twice is the unique index: use the person already there.
  if (error?.code === "23505") {
    const { data: existing } = await db.from("borrowers").select("id").eq("library_id", libraryId).ilike("name", name).maybeSingle();
    if (existing) return { ok: true, id: existing.id as string };
  }
  return { ok: false, error: error?.message ?? "Could not add that person." };
}

export function parseDue(date: string | undefined): { ok: true; dueAt: string | null } | { ok: false; error: string } {
  const due = dueDateToTimestamp(date);
  return due === "invalid" ? { ok: false, error: "Use a valid due date." } : { ok: true, dueAt: due };
}

/** Friendly text for the database's loan rules. */
export function loanError(message: string, code?: string): string {
  if (code === "23505") return "That is already on loan.";
  if (/different library/i.test(message)) return "That person belongs to a different library.";
  if (/borrowed/i.test(message) && code === "23514") return "Only a borrowed book can have a loan in.";
  return message;
}
