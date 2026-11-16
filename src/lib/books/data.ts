import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LibraryRole } from "@/lib/library";
import { activeLoans, type LoanLite } from "@/lib/loans/rules";
import type { ExistingBook } from "@/lib/duplicates";
import type { Condition, Format, Ownership, Status } from "./constants";
import type { LibraryItem } from "./library-query";

type Json = Record<string, unknown>;

/** Embedded relations can come back as an object or a one-element array. */
export function first<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

const PAGE = 1000;

type RawLoan = {
  id: string;
  direction: "out" | "in";
  copy_id: string | null;
  book_id: string;
  borrower_id: string;
  due_at: string | null;
  loaned_at: string;
  returned_at: string | null;
  borrowers: { name: string } | { name: string }[] | null;
};

export function toLoan(r: RawLoan): LoanLite {
  return {
    id: r.id,
    direction: r.direction,
    copyId: r.copy_id,
    bookId: r.book_id,
    borrowerId: r.borrower_id,
    borrowerName: first(r.borrowers)?.name ?? "Someone",
    loanedAt: r.loaned_at,
    dueAt: r.due_at,
    returnedAt: r.returned_at,
  };
}

/** Every book in a library with the per-person and copy data the list needs. */
export async function loadLibraryItems(libraryId: string, userId: string): Promise<LibraryItem[]> {
  const supabase = await createClient();
  const rows: Json[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("books")
      .select(
        "id, title, authors, series_name, series_position, cover_url, ownership, public_rating, created_at, copies(format, purchase_price), user_books(user_id, status, rating), loans(id, direction, copy_id, book_id, borrower_id, due_at, loaned_at, returned_at, borrowers(name))",
      )
      .eq("library_id", libraryId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Json[]));
    if (!data || data.length < PAGE) break;
  }

  const now = new Date();
  return rows.map((r) => {
    const copies = (r.copies as { format: Format; purchase_price: number | null }[]) ?? [];
    const userBooks = (r.user_books as { user_id: string; status: Status; rating: number | null }[]) ?? [];
    const prices = copies.map((c) => c.purchase_price).filter((p): p is number => p !== null);
    const mine = userBooks.find((u) => u.user_id === userId);
    const loans = activeLoans(((r.loans as RawLoan[]) ?? []).map(toLoan), now).map((l) => ({ id: l.id, direction: l.direction, borrowerName: l.borrowerName, dueAt: l.dueAt, overdue: l.overdue }));
    return {
      id: r.id as string,
      title: r.title as string,
      authors: (r.authors as string[]) ?? [],
      seriesName: (r.series_name as string | null) ?? null,
      seriesPosition: r.series_position === null ? null : Number(r.series_position),
      coverUrl: (r.cover_url as string | null) ?? null,
      ownership: r.ownership as Ownership,
      publicRating: r.public_rating === null ? null : Number(r.public_rating),
      createdAt: r.created_at as string,
      formats: [...new Set(copies.map((c) => c.format))],
      totalPaid: prices.length ? prices.reduce((a, b) => a + Number(b), 0) : null,
      mine: mine ? { status: mine.status, rating: mine.rating === null ? null : Number(mine.rating) } : null,
      others: userBooks.filter((u) => u.user_id !== userId).map((u) => ({ userId: u.user_id, status: u.status })),
      loans,
    } satisfies LibraryItem;
  });
}

export type BookRow = {
  id: string;
  library_id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  series_name: string | null;
  series_position: number | null;
  description: string | null;
  cover_url: string | null;
  page_count: number | null;
  published_date: string | null;
  genres: string[];
  isbn13: string | null;
  hardcover_id: number | null;
  google_books_id: string | null;
  ol_key: string | null;
  public_rating: number | null;
  public_rating_count: number | null;
  rating_source: string | null;
  ownership: Ownership;
  created_at: string;
};

export type CopyRow = {
  id: string;
  book_id: string;
  format: Format;
  condition: Condition | null;
  edition_isbn: string | null;
  purchase_price: number | null;
  purchase_date: string | null;
  current_price: number | null;
  current_price_currency: string | null;
  price_checked_at: string | null;
  price_approximate: boolean;
  price_listing_count: number | null;
  created_at: string;
};

export type PricePoint = { price: number; currency: string | null; approximate: boolean; checkedAt: string };

export type ReadRow = { id: string; user_id: string; started_at: string | null; finished_at: string | null };

export type MemberView = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  isMe: boolean;
  status: Status | null;
  rating: number | null;
  notes: string | null;
  reads: ReadRow[];
};

export type BookDetail = {
  book: BookRow;
  copies: CopyRow[];
  /** Price checks per copy, newest first. */
  priceHistory: Record<string, PricePoint[]>;
  /** Every loan of this book or its copies, newest first. */
  loans: LoanLite[];
  priceRegion: string | null;
  me: MemberView;
  others: MemberView[];
  libraryName: string;
  role: LibraryRole;
};

function groupHistory(rows: { copy_id: string; price: number | string; currency: string | null; approximate: boolean; checked_at: string }[]): Record<string, PricePoint[]> {
  const out: Record<string, PricePoint[]> = {};
  for (const r of rows) (out[r.copy_id] ??= []).push({ price: Number(r.price), currency: r.currency, approximate: r.approximate, checkedAt: r.checked_at });
  return out;
}

function displayName(profile: { display_name: string | null; email: string | null } | null): string {
  return profile?.display_name?.trim() || profile?.email?.split("@")[0] || "Member";
}

/** A book with copies and every member's status, rating, notes and reads. Null when not visible. */
export async function loadBookDetail(bookId: string, userId: string): Promise<BookDetail | null> {
  const supabase = await createClient();

  const { data: book } = await supabase.from("books").select("*").eq("id", bookId).maybeSingle();
  if (!book) return null;

  const [copies, members, userBooks, reads, library, loans] = await Promise.all([
    supabase.from("copies").select("*").eq("book_id", bookId).order("created_at"),
    supabase
      .from("library_members")
      .select("user_id, role, profiles(display_name, email, avatar_url)")
      .eq("library_id", book.library_id)
      .order("created_at"),
    supabase.from("user_books").select("user_id, status, rating, notes").eq("book_id", bookId),
    supabase
      .from("reads")
      .select("id, user_id, started_at, finished_at")
      .eq("book_id", bookId)
      .order("finished_at", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false }),
    supabase.from("libraries").select("name, price_region").eq("id", book.library_id).maybeSingle(),
    supabase
      .from("loans")
      .select("id, direction, copy_id, book_id, borrower_id, due_at, loaned_at, returned_at, borrowers(name)")
      .eq("book_id", bookId)
      .order("loaned_at", { ascending: false }),
  ]);
  const copyIds = ((copies.data ?? []) as { id: string }[]).map((c) => c.id);
  const history = copyIds.length
    ? await supabase.from("price_history").select("copy_id, price, currency, approximate, checked_at").in("copy_id", copyIds).order("checked_at", { ascending: false }).limit(300)
    : { data: [] };

  const ub = (userBooks.data ?? []) as { user_id: string; status: Status; rating: number | null; notes: string | null }[];
  const rd = (reads.data ?? []) as ReadRow[];
  const memberRows = (members.data ?? []) as unknown as {
    user_id: string;
    role: LibraryRole;
    profiles: { display_name: string | null; email: string | null; avatar_url: string | null } | { display_name: string | null; email: string | null; avatar_url: string | null }[] | null;
  }[];

  const views: MemberView[] = memberRows.map((m) => {
    const profile = first(m.profiles);
    const row = ub.find((u) => u.user_id === m.user_id);
    return {
      userId: m.user_id,
      name: displayName(profile),
      avatarUrl: profile?.avatar_url ?? null,
      isMe: m.user_id === userId,
      status: row?.status ?? null,
      rating: row?.rating == null ? null : Number(row.rating),
      notes: row?.notes ?? null,
      reads: rd.filter((r) => r.user_id === m.user_id),
    };
  });

  const me = views.find((v) => v.isMe);
  if (!me) return null;

  return {
    book: {
      ...(book as BookRow),
      series_position: book.series_position === null ? null : Number(book.series_position),
      public_rating: book.public_rating === null ? null : Number(book.public_rating),
    },
    copies: ((copies.data ?? []) as CopyRow[]).map((c) => ({
      ...c,
      purchase_price: c.purchase_price === null ? null : Number(c.purchase_price),
      current_price: c.current_price === null ? null : Number(c.current_price),
    })),
    priceHistory: groupHistory((history.data ?? []) as { copy_id: string; price: number | string; currency: string | null; approximate: boolean; checked_at: string }[]),
    loans: ((loans.data ?? []) as unknown as RawLoan[]).map(toLoan),
    priceRegion: (library.data?.price_region as string | null | undefined) ?? null,
    me,
    others: views.filter((v) => !v.isMe),
    libraryName: (library.data?.name as string | undefined) ?? "",
    role: memberRows.find((m) => m.user_id === userId)?.role ?? "viewer",
  };
}

/** Candidate duplicates for an incoming book: ISBN matches first, then books whose title shares a long word. */
export async function loadDuplicateCandidates(
  libraryId: string,
  input: { title: string; isbn13: string | null },
): Promise<ExistingBook[]> {
  const supabase = await createClient();
  const found = new Map<string, ExistingBook>();
  const base = "id, title, authors, isbn13, copies(edition_isbn)";
  const add = (rows: Json[] | null) => {
    for (const r of rows ?? []) {
      found.set(r.id as string, {
        id: r.id as string,
        title: r.title as string,
        authors: (r.authors as string[]) ?? [],
        isbn13: (r.isbn13 as string | null) ?? null,
        copyIsbns: ((r.copies as { edition_isbn: string | null }[]) ?? [])
          .map((c) => c.edition_isbn)
          .filter((s): s is string => !!s),
      });
    }
  };

  if (input.isbn13) {
    const [byBook, byCopy] = await Promise.all([
      supabase.from("books").select(base).eq("library_id", libraryId).eq("isbn13", input.isbn13).limit(10),
      supabase
        .from("books")
        .select(`${base}, copy_match:copies!inner(edition_isbn)`)
        .eq("library_id", libraryId)
        .eq("copy_match.edition_isbn", input.isbn13)
        .limit(10),
    ]);
    add(byBook.data as Json[] | null);
    add(byCopy.data as Json[] | null);
  }

  // Title candidates via the trigram-indexed search_text; the exact comparison happens in findDuplicates.
  const word = input.title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .sort((a, b) => b.length - a.length)[0];
  if (word) {
    const { data } = await supabase
      .from("books")
      .select(base)
      .eq("library_id", libraryId)
      .ilike("search_text", `%${word}%`)
      .limit(100);
    add(data as Json[] | null);
  }
  return [...found.values()];
}
