import "server-only";
import { toLoan } from "@/lib/books/data";
import { createClient } from "@/lib/supabase/server";
import type { LoanLite } from "./rules";

export type BorrowerRow = { id: string; name: string; note: string | null; createdAt: string };

export async function loadBorrowers(libraryId: string): Promise<BorrowerRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("borrowers").select("id, name, note, created_at").eq("library_id", libraryId).order("name");
  return (data ?? []).map((b) => ({ id: b.id as string, name: b.name as string, note: (b.note as string | null) ?? null, createdAt: b.created_at as string }));
}

export type LoanWithBook = LoanLite & { bookTitle: string };

/** Every loan in the library with its book's title, for the Borrowers page. */
export async function loadLibraryLoans(libraryId: string): Promise<LoanWithBook[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loans")
    .select("id, direction, copy_id, book_id, borrower_id, due_at, loaned_at, returned_at, borrowers(name), books(title)")
    .eq("library_id", libraryId)
    .order("loaned_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const book = Array.isArray(r.books) ? r.books[0] : r.books;
    return { ...toLoan(r as unknown as Parameters<typeof toLoan>[0]), bookTitle: (book as { title?: string } | null)?.title ?? "A book" };
  });
}
