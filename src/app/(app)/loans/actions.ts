"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeBook, canEdit, fail, firstIssue, roleInLibrary, type ActionResult } from "@/lib/books/access";
import { requireUser } from "@/lib/library";
import { lendBlocker } from "@/lib/loans/rules";
import { borrowerSchema, lendSchema, returnBorrowedSchema, returnSchema } from "@/lib/loans/schemas";
import { loanError, parseDue, resolveBorrower } from "@/lib/loans/server";
import { createClient } from "@/lib/supabase/server";

function revalidateLoans(bookId?: string) {
  if (bookId) revalidatePath(`/books/${bookId}`);
  revalidatePath("/library");
  revalidatePath("/shelves");
  revalidatePath("/borrowers");
}

/** Lend one of our copies. Editors and owners only; RLS and the database's one-active-loan index back the checks here. */
export async function lendCopy(input: z.input<typeof lendSchema>): Promise<ActionResult> {
  const parsed = lendSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { copyId, who } = parsed.data;

  await requireUser();
  const supabase = await createClient();
  const { data: copy } = await supabase.from("copies").select("id, book_id, format").eq("id", copyId).maybeSingle();
  if (!copy) return fail("That copy does not exist.");
  const auth = await authorizeBook(copy.book_id as string, true);
  if (!auth.ok) return fail(auth.error);

  const { data: existing } = await supabase.from("loans").select("direction, copy_id, returned_at").eq("copy_id", copyId).is("returned_at", null);
  const blocked = lendBlocker(
    { id: copy.id as string, format: copy.format as string },
    (existing ?? []).map((l) => ({ direction: l.direction as "out" | "in", copyId: l.copy_id as string | null, returnedAt: l.returned_at as string | null })),
  );
  if (blocked) return fail(blocked);

  const due = parseDue(parsed.data.dueDate);
  if (!due.ok) return fail(due.error);
  const borrower = await resolveBorrower(supabase, auth.book.library_id as string, who);
  if (!borrower.ok) return fail(borrower.error);

  const { error } = await supabase.from("loans").insert({ direction: "out", copy_id: copyId, borrower_id: borrower.id, due_at: due.dueAt });
  if (error) return fail(loanError(error.message, error.code));
  revalidateLoans(copy.book_id as string);
  return { ok: true };
}

/** Mark a loan out as returned. */
export async function markReturned(input: z.input<typeof returnSchema>): Promise<ActionResult> {
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  await requireUser();
  const supabase = await createClient();
  const { data: loan } = await supabase.from("loans").select("id, book_id, direction, returned_at").eq("id", parsed.data.loanId).maybeSingle();
  if (!loan) return fail("That loan does not exist.");
  if (loan.returned_at) return fail("That loan is already marked returned.");
  const auth = await authorizeBook(loan.book_id as string, true);
  if (!auth.ok) return fail(auth.error);
  const { error } = await supabase.from("loans").update({ returned_at: new Date().toISOString() }).eq("id", parsed.data.loanId).is("returned_at", null);
  if (error) return fail(loanError(error.message, error.code));
  revalidateLoans(loan.book_id as string);
  return { ok: true };
}

/**
 * "Returned it" on a borrowed book: closes the in-loan, then either removes the book from the library or keeps it as a wishlist
 * entry. The loan history goes with a removed book; a kept one keeps its history.
 */
export async function returnBorrowedBook(input: z.input<typeof returnBorrowedSchema>): Promise<ActionResult<{ removed: boolean }>> {
  const parsed = returnBorrowedSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const auth = await authorizeBook(parsed.data.bookId, true);
  if (!auth.ok) return fail(auth.error);
  const { data: book } = await auth.supabase.from("books").select("ownership").eq("id", parsed.data.bookId).maybeSingle();
  if (book?.ownership !== "borrowed") return fail("That book is not marked as borrowed.");

  const { error } = await auth.supabase
    .from("loans")
    .update({ returned_at: new Date().toISOString() })
    .eq("book_id", parsed.data.bookId)
    .eq("direction", "in")
    .is("returned_at", null);
  if (error) return fail(loanError(error.message, error.code));

  if (parsed.data.then === "remove") {
    const { error: delError } = await auth.supabase.from("books").delete().eq("id", parsed.data.bookId);
    if (delError) return fail(delError.message);
    revalidateLoans();
    return { ok: true, removed: true };
  }
  const { error: upError } = await auth.supabase.from("books").update({ ownership: "wishlist" }).eq("id", parsed.data.bookId);
  if (upError) return fail(upError.message);
  await auth.supabase.from("user_books").upsert({ user_id: auth.user.id, book_id: parsed.data.bookId, status: "want" }, { onConflict: "user_id,book_id", ignoreDuplicates: true });
  revalidateLoans(parsed.data.bookId);
  return { ok: true, removed: false };
}

// ---------------------------------------------------------------- borrowers

export async function addBorrower(input: z.input<typeof borrowerSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = borrowerSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const user = await requireUser();
  if (!canEdit(await roleInLibrary(parsed.data.libraryId, user.id))) return fail("Only owners and editors can change the borrowers list.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("borrowers")
    .insert({ library_id: parsed.data.libraryId, name: parsed.data.name, note: parsed.data.note || null })
    .select("id")
    .single();
  if (error) return fail(error.code === "23505" ? "Someone with that name is already on the list." : error.message);
  revalidatePath("/borrowers");
  return { ok: true, id: data.id as string };
}

export async function deleteBorrower(borrowerId: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(borrowerId);
  if (!parsed.success) return fail("That person is not valid.");
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("borrowers").delete().eq("id", parsed.data).select("id");
  if (error) return fail(error.code === "23503" ? "They have loans on record, so they stay on the list." : error.message);
  if (!data || data.length === 0) return fail("Only owners and editors can change the borrowers list.");
  revalidatePath("/borrowers");
  return { ok: true };
}

