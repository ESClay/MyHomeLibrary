import { beforeEach, describe, expect, it, vi } from "vitest";

const authorize = vi.fn();
const update = vi.fn();
const insert = vi.fn();
const revalidate = vi.fn();
let existing: Record<string, unknown> | null;

const BOOK = "22222222-2222-4222-8222-222222222222";
const EMPTY = {
  subtitle: null, authors: [], series_name: null, series_position: null, description: null, cover_url: "https://a/old.jpg", page_count: null,
  published_date: null, genres: [], isbn13: null, hardcover_id: null, google_books_id: null, ol_key: null,
  public_rating: null, public_rating_count: null, rating_source: null, ownership: "wishlist",
};

const supabase = {
  from: (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: existing, error: null }) }) }),
    update: (v: unknown) => (update(table, v), { eq: () => ({ eq: () => Promise.resolve({ error: null }), then: (r: (v: unknown) => unknown) => r({ error: null }) }) }),
    insert: (v: unknown) => (insert(table, v), Promise.resolve({ error: null })),
  }),
};

vi.mock("@/lib/books/access", async (orig) => ({ ...(await orig<typeof import("@/lib/books/access")>()), authorizeBook: (...a: unknown[]) => authorize(...a) }));
vi.mock("@/lib/library", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidate(...a) }));
vi.mock("@/lib/access", () => ({ providerPolicyFor: vi.fn() }));
vi.mock("@/lib/metadata", () => ({ refreshFor: vi.fn() }));
vi.mock("@/lib/books/data", () => ({ loadDuplicateCandidates: vi.fn() }));
vi.mock("@/lib/loans/server", () => ({ loanError: vi.fn(), parseDue: vi.fn(), resolveBorrower: vi.fn() }));
vi.mock("@/lib/shelves/assign", () => ({ attachBooksToShelves: vi.fn() }));

import { updateExistingBook } from "./actions";

const book = { title: "T", authors: ["A"], description: "New text", coverUrl: "https://a/new.jpg", ownership: "owned" as const };

beforeEach(() => {
  vi.clearAllMocks();
  existing = { ...EMPTY };
  authorize.mockResolvedValue({ ok: true, supabase, book: { id: BOOK, isbn13: null }, role: "editor" });
});

describe("updateExistingBook", () => {
  it("passes the role check through and stops on a refusal", async () => {
    authorize.mockResolvedValue({ ok: false, error: "Only owners and editors can change the library." });
    expect(await updateExistingBook({ bookId: BOOK, book, provider: {} })).toEqual({ ok: false, error: "Only owners and editors can change the library." });
    expect(authorize).toHaveBeenCalledWith(BOOK, true);
    expect(update).not.toHaveBeenCalled();
  });
  it("rejects bad input", async () => {
    expect((await updateExistingBook({ bookId: "x", book, provider: {} })).ok).toBe(false);
    expect((await updateExistingBook({ bookId: BOOK, book: { ...book, title: "" }, provider: {} })).ok).toBe(false);
  });
  it("fills empty fields, keeps the old cover unless asked, and adds the owned copy", async () => {
    const res = await updateExistingBook({ bookId: BOOK, book, provider: {}, copy: { format: "paperback" } });
    expect(res).toEqual({ ok: true });
    const patch = update.mock.calls[0][1];
    expect(patch).toMatchObject({ description: "New text", authors: ["A"] });
    expect(patch).not.toHaveProperty("cover_url");
    expect(insert).toHaveBeenCalledWith("copies", expect.objectContaining({ book_id: BOOK, format: "paperback" }));
    expect(revalidate).toHaveBeenCalledWith("/library");
  });
  it("replaces the cover when asked, and adds no copy for a wishlist add", async () => {
    await updateExistingBook({ bookId: BOOK, book: { ...book, ownership: "wishlist" }, provider: {}, replaceCover: true, copy: { format: "paperback" } });
    expect(update.mock.calls[0][1]).toMatchObject({ cover_url: "https://a/new.jpg" });
    expect(insert).not.toHaveBeenCalled();
  });
});
